package com.transfert.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.transfert.app.usbfs.BulkTransport;
import com.transfert.app.usbfs.FileSystemReader;
import com.transfert.app.usbfs.FsEntry;
import com.transfert.app.usbfs.FsFile;
import com.transfert.app.usbfs.ScsiBlockDevice;
import com.transfert.app.usbfs.VolumeScanner;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Lecture directe des clés USB et disques durs branchés en OTG (API USB Host d'Android).
 * Pilotes intégrés (lecture seule) : FAT16/FAT32, exFAT et NTFS, indépendants du montage Android.
 */
@CapacitorPlugin(name = "UsbDirect")
public class UsbDirectPlugin extends Plugin {
    private static final String ACTION_PERMISSION = "com.transfert.app.USB_PERMISSION";

    private static final class Node {
        final FsEntry entry;
        final int volume;
        Node(FsEntry entry, int volume) { this.entry = entry; this.volume = volume; }
    }

    private UsbDeviceConnection connection;
    private UsbInterface claimed;
    private final List<VolumeScanner.Volume> volumes = new ArrayList<>();
    private final Map<String, Node> nodes = new HashMap<>();
    private int nodeSeq = 0;

    private volatile boolean copying;
    private volatile boolean cancelRequested;
    private volatile long copyDone;
    private volatile long copyTotal;
    private volatile String copyName = "";
    private volatile String phase = "";

    // ---- détection --------------------------------------------------------------------------

    private UsbManager manager() { return (UsbManager) getContext().getSystemService(Context.USB_SERVICE); }

    /** Interface « Bulk-Only » (classe 8, SCSI) d'un périphérique de stockage, ou null. */
    private static UsbInterface massStorageInterface(UsbDevice d) {
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            UsbInterface in = d.getInterface(i);
            if (in.getInterfaceClass() == UsbConstants.USB_CLASS_MASS_STORAGE && in.getInterfaceSubclass() == 6 && in.getInterfaceProtocol() == 0x50) {
                return in;
            }
        }
        return null;
    }

    private static String deviceLabel(UsbDevice d) {
        String name = null;
        try { name = d.getProductName(); } catch (Exception ignored) { /* indisponible */ }
        return name == null || name.trim().isEmpty() ? String.format("USB %04x:%04x", d.getVendorId(), d.getProductId()) : name;
    }

    @PluginMethod
    public void scan(PluginCall call) {
        UsbManager m = manager();
        JSArray devices = new JSArray();
        JSArray others = new JSArray();
        if (m != null) {
            for (UsbDevice d : m.getDeviceList().values()) {
                if (massStorageInterface(d) == null) { others.put(deviceLabel(d)); continue; }
                JSObject o = new JSObject();
                o.put("id", d.getDeviceName());
                o.put("name", deviceLabel(d));
                o.put("permission", m.hasPermission(d));
                devices.put(o);
            }
        }
        JSObject r = new JSObject();
        r.put("devices", devices);
        r.put("others", others);
        call.resolve(r);
    }

    // ---- ouverture ---------------------------------------------------------------------------

    @PluginMethod
    public void open(final PluginCall call) {
        final UsbManager m = manager();
        String id = call.getString("id");
        UsbDevice target = null;
        if (m != null) {
            for (UsbDevice d : m.getDeviceList().values()) {
                if (massStorageInterface(d) != null && (id == null || id.equals(d.getDeviceName()))) { target = d; break; }
            }
        }
        if (target == null) { call.reject("Aucun support USB détecté. Rebranchez l'adaptateur OTG."); return; }
        final UsbDevice dev = target;
        if (m.hasPermission(dev)) { startOpen(call, dev); return; }

        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                try { getContext().unregisterReceiver(this); } catch (Exception ignored) { /* déjà retiré */ }
                boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false) || m.hasPermission(dev);
                if (granted) startOpen(call, dev);
                else call.reject("Accès USB refusé. Acceptez la demande d'Android pour lire le support.");
            }
        };
        IntentFilter filter = new IntentFilter(ACTION_PERMISSION);
        if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else getContext().registerReceiver(receiver, filter);
        Intent intent = new Intent(ACTION_PERMISSION);
        intent.setPackage(getContext().getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        m.requestPermission(dev, PendingIntent.getBroadcast(getContext(), 0, intent, flags));
    }

    private void startOpen(final PluginCall call, final UsbDevice dev) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    phase = "Ouverture du support…";
                    closeInternal();
                    UsbInterface iface = massStorageInterface(dev);
                    UsbDeviceConnection c = manager().openDevice(dev);
                    if (c == null) throw new IOException("Android n'a pas pu ouvrir le périphérique USB.");
                    synchronized (UsbDirectPlugin.this) { connection = c; }
                    if (!c.claimInterface(iface, true)) throw new IOException("Impossible de prendre le contrôle du support de stockage USB.");
                    synchronized (UsbDirectPlugin.this) { claimed = iface; }
                    c.setInterface(iface);
                    UsbEndpoint in = null;
                    UsbEndpoint out = null;
                    for (int i = 0; i < iface.getEndpointCount(); i++) {
                        UsbEndpoint ep = iface.getEndpoint(i);
                        if (ep.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK) continue;
                        if (ep.getDirection() == UsbConstants.USB_DIR_IN) in = ep; else out = ep;
                    }
                    if (in == null || out == null) throw new IOException("Le support n'expose pas les canaux de transfert attendus.");
                    phase = "Support ouvert, démarrage…";
                    ScsiBlockDevice block = new ScsiBlockDevice(new AndroidTransport(c, iface, in, out), new ScsiBlockDevice.StatusListener() {
                        @Override public void onStatus(String text) { phase = text; }
                    });
                    phase = "Analyse des partitions…";
                    List<String> notes = new ArrayList<>();
                    List<VolumeScanner.Volume> found = VolumeScanner.scan(block, notes);
                    JSArray vols = new JSArray();
                    synchronized (UsbDirectPlugin.this) {
                        volumes.clear();
                        volumes.addAll(found);
                        nodes.clear();
                        nodeSeq = 0;
                    }
                    for (int i = 0; i < found.size(); i++) {
                        FileSystemReader fs = found.get(i).fs;
                        JSObject o = new JSObject();
                        o.put("index", i);
                        o.put("title", found.get(i).title);
                        o.put("type", fs.type());
                        o.put("label", fs.label());
                        o.put("size", found.get(i).sizeBytes);
                        vols.put(o);
                    }
                    JSArray noteArray = new JSArray();
                    for (String n : notes) noteArray.put(n);
                    JSObject r = new JSObject();
                    r.put("volumes", vols);
                    r.put("notes", noteArray);
                    r.put("capacity", block.blockCount() * (long) block.blockSize());
                    call.resolve(r);
                } catch (Exception e) {
                    closeInternal();
                    call.reject("Lecture directe impossible : " + e.getMessage());
                }
            }
        }, "usb-open").start();
    }

    private synchronized void closeInternal() {
        if (connection != null) {
            try { if (claimed != null) connection.releaseInterface(claimed); } catch (Exception ignored) { /* ignoré */ }
            try { connection.close(); } catch (Exception ignored) { /* ignoré */ }
        }
        connection = null;
        claimed = null;
        volumes.clear();
        nodes.clear();
    }

    /** Étape en cours pendant l'ouverture (pour l'afficher à l'écran). */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("phase", phase);
        call.resolve(r);
    }

    @PluginMethod
    public void close(PluginCall call) {
        cancelRequested = true;
        closeInternal();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        closeInternal();
    }

    // ---- navigation --------------------------------------------------------------------------

    private synchronized Node resolveNode(String token) {
        if (token == null) return null;
        if (token.startsWith("v")) {
            try {
                int index = Integer.parseInt(token.substring(1));
                if (index < 0 || index >= volumes.size()) return null;
                return new Node(volumes.get(index).fs.root(), index);
            } catch (NumberFormatException e) { return null; }
        }
        return nodes.get(token);
    }

    private synchronized String register(Node node) {
        String token = "e" + (++nodeSeq);
        nodes.put(token, node);
        return token;
    }

    @PluginMethod
    public void list(final PluginCall call) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    Node node = resolveNode(call.getString("token"));
                    if (node == null || !node.entry.directory) throw new IOException("Dossier introuvable : reconnectez le support.");
                    FileSystemReader fs;
                    synchronized (UsbDirectPlugin.this) { fs = volumes.get(node.volume).fs; }
                    List<FsEntry> entries = fs.list(node.entry);
                    Collections.sort(entries, new Comparator<FsEntry>() {
                        @Override public int compare(FsEntry a, FsEntry b) {
                            if (a.directory != b.directory) return a.directory ? -1 : 1;
                            return a.name.compareToIgnoreCase(b.name);
                        }
                    });
                    JSArray items = new JSArray();
                    for (FsEntry e : entries) {
                        JSObject o = new JSObject();
                        o.put("name", e.name);
                        o.put("uri", register(new Node(e, node.volume)));
                        o.put("directory", e.directory);
                        o.put("size", e.directory ? 0L : e.size);
                        items.put(o);
                    }
                    JSObject r = new JSObject();
                    r.put("name", fs.label().isEmpty() ? fs.type() : fs.label());
                    r.put("items", items);
                    call.resolve(r);
                } catch (Exception e) {
                    call.reject("Dossier illisible : " + e.getMessage());
                }
            }
        }, "usb-list").start();
    }

    // ---- copie vers Téléchargements -----------------------------------------------------------

    private static String safeName(String name) {
        String n = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (n.isEmpty() || n.equals(".") || n.equals("..")) n = "fichier";
        return n.length() > 200 ? n.substring(0, 200) : n;
    }

    private static String mimeFor(String name) {
        int dot = name.lastIndexOf('.');
        String mime = dot > 0 ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(dot + 1).toLowerCase()) : null;
        return mime == null ? "application/octet-stream" : mime;
    }

    private static File uniqueFile(File dir, String name) {
        File f = new File(dir, name);
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int k = 1; f.exists(); k++) f = new File(dir, base + " (" + k + ")" + ext);
        return f;
    }

    @PluginMethod
    public void copyToDownloads(final PluginCall call) {
        if (copying) { call.reject("Une copie est déjà en cours."); return; }
        final Node node = resolveNode(call.getString("token"));
        if (node == null || node.entry.directory) { call.reject("Fichier introuvable : rouvrez le dossier."); return; }
        copying = true;
        cancelRequested = false;
        copyDone = 0;
        copyTotal = node.entry.size;
        copyName = node.entry.name;
        new Thread(new Runnable() {
            @Override public void run() {
                ContentResolver cr = getContext().getContentResolver();
                Uri target = null;
                File legacy = null;
                try {
                    FileSystemReader fs;
                    synchronized (UsbDirectPlugin.this) { fs = volumes.get(node.volume).fs; }
                    FsFile src = fs.open(node.entry);
                    copyTotal = src.size();
                    String name = safeName(node.entry.name);
                    OutputStream out;
                    if (Build.VERSION.SDK_INT >= 29) {
                        ContentValues v = new ContentValues();
                        v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                        v.put(MediaStore.Downloads.MIME_TYPE, mimeFor(name));
                        v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/TRANSFERT-USB");
                        v.put(MediaStore.Downloads.IS_PENDING, 1);
                        target = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                        if (target == null) throw new IOException("Impossible de créer le fichier dans Téléchargements");
                        out = cr.openOutputStream(target);
                    } else {
                        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "TRANSFERT-USB");
                        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Impossible de créer le dossier TRANSFERT-USB");
                        legacy = uniqueFile(dir, name);
                        out = new FileOutputStream(legacy);
                    }
                    if (out == null) throw new IOException("Flux de sortie indisponible");
                    long pos = 0;
                    try {
                        byte[] buf = new byte[1024 * 1024];
                        int n;
                        while ((n = src.read(pos, buf, 0, buf.length)) > 0) {
                            if (cancelRequested) throw new IOException("Copie annulée");
                            out.write(buf, 0, n);
                            pos += n;
                            copyDone = pos;
                        }
                        out.flush();
                    } finally {
                        out.close();
                    }
                    if (target != null) {
                        ContentValues done = new ContentValues();
                        done.put(MediaStore.Downloads.IS_PENDING, 0);
                        cr.update(target, done, null, null);
                    }
                    JSObject r = new JSObject();
                    r.put("name", name);
                    r.put("bytes", pos);
                    call.resolve(r);
                } catch (Exception e) {
                    if (target != null) { try { cr.delete(target, null, null); } catch (Exception ignored) { /* ignoré */ } }
                    if (legacy != null) legacy.delete();
                    call.reject("Échec de copie : " + e.getMessage());
                } finally {
                    copying = false;
                }
            }
        }, "usb-copy").start();
    }

    @PluginMethod
    public void progress(PluginCall call) {
        JSObject r = new JSObject();
        r.put("copying", copying);
        r.put("done", copyDone);
        r.put("total", copyTotal);
        r.put("name", copyName);
        call.resolve(r);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelRequested = true;
        call.resolve();
    }

    // ---- transport USB ------------------------------------------------------------------------

    private static final class AndroidTransport implements BulkTransport {
        private final UsbDeviceConnection c;
        private final UsbInterface iface;
        private final UsbEndpoint in;
        private final UsbEndpoint out;

        AndroidTransport(UsbDeviceConnection c, UsbInterface iface, UsbEndpoint in, UsbEndpoint out) {
            this.c = c; this.iface = iface; this.in = in; this.out = out;
        }
        @Override public int bulkOut(byte[] buf, int off, int len, int timeoutMs) { return c.bulkTransfer(out, buf, off, len, timeoutMs); }
        @Override public int bulkIn(byte[] buf, int off, int len, int timeoutMs) { return c.bulkTransfer(in, buf, off, len, timeoutMs); }
        @Override public void clearHalt(boolean isIn) {
            UsbEndpoint ep = isIn ? in : out;
            c.controlTransfer(0x02, 0x01, 0, ep.getAddress(), null, 0, 1000);
        }
        @Override public boolean resetRecovery() { return c.controlTransfer(0x21, 0xFF, 0, iface.getId(), null, 0, 2000) >= 0; }
        @Override public int maxPacket(boolean isIn) { return (isIn ? in : out).getMaxPacketSize(); }
    }
}
