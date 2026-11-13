// Adapte le projet Android généré par « npx cap add android » :
// permissions, trafic HTTP local, téléchargements natifs, USB OTG (SAF + pilotes directs) et numéro de version.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(root, 'android');
const manifestPath = path.join(androidDir, 'app/src/main/AndroidManifest.xml');
const gradlePath = path.join(androidDir, 'app/build.gradle');
const javaDir = path.join(androidDir, 'app/src/main/java/com/transfert/app');

function mustReplace(text, search, replacement, label) {
  const found = search instanceof RegExp ? search.test(text) : text.includes(search);
  if (!found) {
    throw new Error(`Patch Android impossible (${label}) : le modèle Capacitor a changé.`);
  }
  return text.replace(search, replacement);
}

// --- AndroidManifest.xml
let manifest = fs.readFileSync(manifestPath, 'utf8');
const wantedManifestLines = [
  ['android.permission.CAMERA', '<uses-permission android:name="android.permission.CAMERA" />'],
  ['android.permission.WRITE_EXTERNAL_STORAGE', '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />'],
  ['android.permission.ACCESS_NETWORK_STATE', '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />'],
  ['android.permission.ACCESS_WIFI_STATE', '<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />'],
  ['android.hardware.camera', '<uses-feature android:name="android.hardware.camera" android:required="false" />'],
  ['android.hardware.usb.host', '<uses-feature android:name="android.hardware.usb.host" android:required="false" />'],
];
for (const [needle, line] of wantedManifestLines) {
  if (!manifest.includes(needle)) manifest = mustReplace(manifest, '</manifest>', `    ${line}\n</manifest>`, needle);
}
// Android propose d'ouvrir TRANSFERT au branchement d'un support USB (et accorde alors l'accès à ce support).
if (!manifest.includes('USB_DEVICE_ATTACHED')) {
  manifest = mustReplace(
    manifest,
    '</activity>',
    `    <intent-filter>
                <action android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED" />
            </intent-filter>
            <meta-data android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED" android:resource="@xml/usb_device_filter" />
        </activity>`,
    'usb intent-filter',
  );
}
if (!manifest.includes('usesCleartextTraffic')) {
  manifest = mustReplace(manifest, '<application', '<application\n        android:usesCleartextTraffic="true"', 'cleartext');
}
fs.writeFileSync(manifestPath, manifest);

// --- MainActivity.java : les téléchargements du WebView passent par le gestionnaire de téléchargement d'Android
fs.mkdirSync(javaDir, { recursive: true });
fs.writeFileSync(
  path.join(javaDir, 'MainActivity.java'),
  `package com.transfert.app;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.webkit.URLUtil;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(UsbStoragePlugin.class);
        registerPlugin(UsbDirectPlugin.class);
        registerPlugin(LanPlugin.class);
        super.onCreate(savedInstanceState);
        WifiBinder.start(getApplicationContext());
    }
    @Override
    public void onStart() {
        super.onStart();
        getBridge().getWebView().setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                Toast.makeText(MainActivity.this, "Ce type de téléchargement n'est pas pris en charge.", Toast.LENGTH_LONG).show();
                return;
            }
            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle(fileName);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            manager.enqueue(request);
            Toast.makeText(MainActivity.this, "Téléchargement : " + fileName + " (dossier Téléchargements)", Toast.LENGTH_LONG).show();
        });
    }
}
`,
);

// --- Plugin SAF : navigation et copie en flux des fichiers sur un support USB.
const pluginPath = path.join(javaDir, 'UsbStoragePlugin.java');
fs.writeFileSync(pluginPath, `package com.transfert.app;

import android.content.Intent;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.DocumentsContract;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.*;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;

@CapacitorPlugin(name = "UsbStorage")
public class UsbStoragePlugin extends Plugin {
    private PluginCall pendingPick;
    private PluginCall pendingCopy;
    private Uri selectedTree;

    @PluginMethod public void pickUsb(PluginCall call) {
        pendingPick = call;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "treePicked");
    }
    @ActivityCallback private void treePicked(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) { call.reject("Sélection annulée"); return; }
        Uri uri = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            selectedTree = uri;
            getContext().getSharedPreferences("usb_storage", 0).edit().putString("tree", uri.toString()).apply();
            JSObject out = new JSObject(); out.put("uri", uri.toString()); call.resolve(out);
        } catch (Exception e) { call.reject("Permission USB non conservable : " + e.getMessage()); }
    }
    @PluginMethod public void list(PluginCall call) {
        String raw = call.getString("uri");
        if (raw == null || raw.isEmpty()) raw = getContext().getSharedPreferences("usb_storage", 0).getString("tree", null);
        if (raw == null) { call.reject("Aucun support USB sélectionné"); return; }
        Uri current = Uri.parse(raw);
        String treeRaw = getContext().getSharedPreferences("usb_storage", 0).getString("tree", null);
        if (treeRaw == null) { call.reject("Permission USB absente ; reconnectez le support"); return; }
        Uri tree = Uri.parse(treeRaw);
        String documentId;
        try { documentId = current.toString().contains("/document/") ? DocumentsContract.getDocumentId(current) : DocumentsContract.getTreeDocumentId(current); }
        catch (Exception e) { documentId = DocumentsContract.getTreeDocumentId(tree); }
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, documentId);
        JSArray items = new JSArray(); String folderName = "Support USB";
        try (android.database.Cursor cursor = getContext().getContentResolver().query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE}, null, null, null)) {
            if (cursor == null) throw new IOException("Le système ne répond pas au support USB");
            int idCol = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameCol = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int mimeCol = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE);
            int sizeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
            while (cursor.moveToNext()) {
                String childId = cursor.getString(idCol); String childName = cursor.getString(nameCol); String mime = cursor.getString(mimeCol);
                JSObject item = new JSObject(); item.put("name", childName == null ? "Sans nom" : childName);
                item.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, childId).toString());
                item.put("directory", DocumentsContract.Document.MIME_TYPE_DIR.equals(mime));
                item.put("size", sizeCol >= 0 && !cursor.isNull(sizeCol) ? cursor.getLong(sizeCol) : 0); items.put(item);
            }
        } catch (Exception e) { call.reject("Dossier USB inaccessible ou support débranché : " + e.getMessage()); return; }
        JSObject out = new JSObject(); out.put("name", folderName); out.put("items", items); call.resolve(out);
    }
    @PluginMethod public void copyToDownloads(PluginCall call) {
        String raw = call.getString("uri");
        if (raw == null) { call.reject("Fichier USB manquant"); return; }
        Uri source = Uri.parse(raw); String name = call.getString("name", "fichier-usb");
        ContentValues values = new ContentValues(); values.put(MediaStore.Downloads.DISPLAY_NAME, name); values.put(MediaStore.Downloads.MIME_TYPE, "application/octet-stream");
        if (android.os.Build.VERSION.SDK_INT >= 29) values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/TRANSFERT-USB");
        Uri target = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (target == null) { call.reject("Impossible de créer le fichier dans Téléchargements"); return; }
        try (InputStream in = getContext().getContentResolver().openInputStream(source); OutputStream out = getContext().getContentResolver().openOutputStream(target)) {
            if (in == null || out == null) throw new IOException("Flux indisponible");
            byte[] buffer = new byte[1024 * 1024]; int n; while ((n = in.read(buffer)) >= 0) out.write(buffer, 0, n);
            JSObject result = new JSObject(); result.put("name", name); result.put("uri", target.toString()); call.resolve(result);
        } catch (Exception e) { getContext().getContentResolver().delete(target, null, null); call.reject("Échec de copie USB : " + e.getMessage()); }
    }
    @PluginMethod public void copyFromPhone(PluginCall call) {
        String tree = call.getString("treeUri"); if (tree == null) { call.reject("Support USB manquant"); return; }
        pendingCopy = call;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT); intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("*/*");
        startActivityForResult(call, intent, "phoneFilePicked");
    }
    @ActivityCallback private void phoneFilePicked(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) { call.reject("Sélection annulée"); return; }
        Uri source = result.getData().getData(); String tree = call.getString("treeUri");
        DocumentFile root = DocumentFile.fromTreeUri(getContext(), Uri.parse(tree));
        if (root == null || !root.canWrite()) { call.reject("Le support USB est en lecture seule ou débranché"); return; }
        String name = "fichier";
        android.database.Cursor c = getContext().getContentResolver().query(source, null, null, null, null);
        if (c != null) { try { int i = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME); if (i >= 0 && c.moveToFirst()) name = c.getString(i); } finally { c.close(); } }
        String mime = getContext().getContentResolver().getType(source); if (mime == null) mime = "application/octet-stream";
        String finalName = name; int dot = name.lastIndexOf('.'); String base = dot > 0 ? name.substring(0, dot) : name; String ext = dot > 0 ? name.substring(dot) : ""; int k = 1;
        while (root.findFile(finalName) != null) finalName = base + " (" + (k++) + ")" + ext;
        DocumentFile dest = root.createFile(mime, finalName);
        if (dest == null) { call.reject("Impossible de créer le fichier sur le support USB"); return; }
        try (InputStream in = getContext().getContentResolver().openInputStream(source); OutputStream out = getContext().getContentResolver().openOutputStream(dest.getUri())) {
            if (in == null || out == null) throw new IOException("Flux indisponible"); byte[] buffer = new byte[1024 * 1024]; int n; while ((n = in.read(buffer)) >= 0) out.write(buffer, 0, n);
            JSObject resultJson = new JSObject(); resultJson.put("name", finalName); call.resolve(resultJson);
        } catch (Exception e) { dest.delete(); call.reject("Échec de copie vers USB : " + e.getMessage()); }
    }
}
`);

// --- Sources natives (pilotes USB FAT32/exFAT/NTFS, sonde réseau, liaison Wi-Fi) et ressources.
const nativeDir = path.join(root, 'native');
function copyJava(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const file of fs.readdirSync(from)) {
    if (file.endsWith('.java')) fs.copyFileSync(path.join(from, file), path.join(to, file));
  }
}
copyJava(nativeDir, javaDir);
copyJava(path.join(nativeDir, 'usbfs'), path.join(javaDir, 'usbfs'));
const xmlDir = path.join(androidDir, 'app/src/main/res/xml');
fs.mkdirSync(xmlDir, { recursive: true });
fs.copyFileSync(path.join(nativeDir, 'res/usb_device_filter.xml'), path.join(xmlDir, 'usb_device_filter.xml'));

// --- jsQR (lecture du QR code dans le lanceur) : fichier absent du dossier www, donc copié depuis node_modules.
const jsqrSource = path.join(root, 'node_modules/jsqr/dist/jsQR.js');
if (!fs.existsSync(jsqrSource)) throw new Error('jsQR introuvable : lancez « npm install » dans mobile/ avant ce script.');
fs.copyFileSync(jsqrSource, path.join(root, 'www/jsQR.js'));

// --- build.gradle : dépendance AndroidX DocumentFile pour le Storage Access Framework
let gradleDeps = fs.readFileSync(gradlePath, 'utf8');
if (!gradleDeps.includes('androidx.documentfile:documentfile')) {
  gradleDeps = mustReplace(gradleDeps, /dependencies\s*\{/, match => `${match}\n    implementation 'androidx.documentfile:documentfile:1.0.1'`, 'documentfile dependency');
  fs.writeFileSync(gradlePath, gradleDeps);
}

// --- build.gradle : version
let gradle = fs.readFileSync(gradlePath, 'utf8');
const versionName = process.env.APP_VERSION || '1.0.14';
const versionCode = process.env.APP_VERSION_CODE || '14';
gradle = mustReplace(gradle, /versionCode \d+/, `versionCode ${versionCode}`, 'versionCode');
gradle = mustReplace(gradle, /versionName "[^"]*"/, `versionName "${versionName}"`, 'versionName');
fs.writeFileSync(gradlePath, gradle);

console.log(`Projet Android adapté : version ${versionName} (code ${versionCode}).`);
