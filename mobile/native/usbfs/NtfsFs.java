package com.transfert.app.usbfs;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * NTFS, lecture seule : dossiers (index B-tree), fichiers résidents et non résidents,
 * fichiers fragmentés (liste d'attributs) et fichiers creux. Les fichiers compressés ou chiffrés (EFS)
 * sont signalés comme non lisibles.
 */
public final class NtfsFs implements FileSystemReader {
    private static final int AT_ATTRLIST = 0x20;
    private static final int AT_VOLNAME = 0x60;
    private static final int AT_DATA = 0x80;
    private static final int AT_INDEX_ROOT = 0x90;
    private static final int AT_INDEX_ALLOC = 0xA0;

    private static final class Run {
        final long vcn, len, lcn;
        Run(long vcn, long len, long lcn) { this.vcn = vcn; this.len = len; this.lcn = lcn; }
    }

    private static final class Attr {
        int type;
        boolean nonResident;
        String name = "";
        int flags;
        long startVcn;
        byte[] resident;
        final List<Run> runs = new ArrayList<>();
        long real, init;
    }

    private static final class Stream {
        boolean resident;
        byte[] data;
        List<Run> runs;
        long real, init;
        int flags;
    }

    private final ByteSource src;
    private final long clusterBytes;
    private final int recSize;
    private final int idxSize;
    private Stream mft;
    private String label = "";

    static boolean matches(byte[] v) {
        return v.length >= 11 && "NTFS    ".equals(new String(v, 3, 8, StandardCharsets.ISO_8859_1));
    }

    public NtfsFs(ByteSource src, byte[] v) throws IOException {
        this.src = src;
        int bps = Le.u16(v, 11);
        int spcRaw = Le.u8(v, 13);
        long spc = spcRaw <= 0x80 ? spcRaw : (1L << (256 - spcRaw));
        if (bps < 512 || spc < 1) throw new IOException("Paramètres NTFS invalides");
        clusterBytes = bps * spc;
        int cpr = v[64];
        int cpi = v[68];
        recSize = cpr > 0 ? (int) (cpr * clusterBytes) : (1 << -cpr);
        idxSize = cpi > 0 ? (int) (cpi * clusterBytes) : (1 << -cpi);
        if (recSize < 256 || recSize > 65536 || idxSize < 512 || idxSize > 1 << 20) throw new IOException("Paramètres NTFS invalides");
        long mftLcn = Le.u64(v, 48);

        byte[] rec0 = new byte[recSize];
        if (src.read(mftLcn * clusterBytes, rec0, 0, recSize) != recSize) throw new IOException("$MFT illisible");
        applyFixups(rec0, "FILE");
        Stream boot = buildStream(select(parseAttrs(rec0), AT_DATA, ""));
        if (boot == null || boot.resident) throw new IOException("$MFT invalide");
        mft = boot;
        mft = buildStream(gather(0, rec0, AT_DATA, ""));
        try {
            byte[] rec3 = readRecord(3);
            for (Attr a : parseAttrs(rec3)) {
                if (a.type == AT_VOLNAME && !a.nonResident && a.resident != null) {
                    label = new String(a.resident, StandardCharsets.UTF_16LE);
                }
            }
        } catch (IOException ignored) { /* libellé facultatif */ }
    }

    @Override public String type() { return "NTFS"; }
    @Override public String label() { return label; }
    @Override public FsEntry root() { return new FsEntry("", true, 0, 5, 0, 0); }

    // ---- enregistrements MFT -------------------------------------------------------------

    private static void applyFixups(byte[] b, String signature) throws IOException {
        for (int i = 0; i < 4; i++) {
            if (b[i] != (byte) signature.charAt(i)) throw new IOException("Signature NTFS invalide");
        }
        int usaOff = Le.u16(b, 4);
        int usaCnt = Le.u16(b, 6);
        if (usaOff < 8 || usaCnt < 1 || usaOff + 2 * usaCnt > b.length) throw new IOException("Table de contrôle NTFS invalide");
        for (int i = 1; i < usaCnt; i++) {
            int p = i * 512 - 2;
            if (p + 2 > b.length) break;
            if (b[p] != b[usaOff] || b[p + 1] != b[usaOff + 1]) throw new IOException("Enregistrement NTFS corrompu");
            b[p] = b[usaOff + 2 * i];
            b[p + 1] = b[usaOff + 2 * i + 1];
        }
    }

    private byte[] readRecord(long n) throws IOException {
        byte[] rec = new byte[recSize];
        int got = readStream(mft, n * recSize, rec, 0, recSize);
        if (got != recSize) throw new IOException("Enregistrement NTFS " + n + " illisible");
        applyFixups(rec, "FILE");
        return rec;
    }

    private static List<Attr> parseAttrs(byte[] rec) throws IOException {
        List<Attr> list = new ArrayList<>();
        int o = Le.u16(rec, 20);
        int used = (int) Math.min(Le.u32(rec, 24), (long) rec.length);
        while (o + 16 <= used) {
            long type = Le.u32(rec, o);
            if (type == 0xFFFFFFFFL) break;
            int alen = (int) Le.u32(rec, o + 4);
            if (alen < 16 || o + alen > used) break;
            Attr a = new Attr();
            a.type = (int) type;
            a.nonResident = rec[o + 8] != 0;
            int nlen = Le.u8(rec, o + 9);
            int noff = Le.u16(rec, o + 10);
            a.flags = Le.u16(rec, o + 12);
            if (nlen > 0 && noff + nlen * 2 <= alen) a.name = new String(rec, o + noff, nlen * 2, StandardCharsets.UTF_16LE);
            if (!a.nonResident) {
                int clen = (int) Le.u32(rec, o + 16);
                int coff = Le.u16(rec, o + 20);
                if (clen < 0 || coff + clen > alen) { o += alen; continue; }
                a.resident = Arrays.copyOfRange(rec, o + coff, o + coff + clen);
            } else {
                if (alen < 64) { o += alen; continue; }
                a.startVcn = Le.u64(rec, o + 16);
                a.real = Le.u64(rec, o + 48);
                a.init = Le.u64(rec, o + 56);
                parseRuns(rec, o + Le.u16(rec, o + 32), o + alen, a.startVcn, a.runs);
            }
            list.add(a);
            o += alen;
        }
        return list;
    }

    private static void parseRuns(byte[] rec, int p, int end, long startVcn, List<Run> out) throws IOException {
        long vcn = startVcn;
        long lcn = 0;
        while (p < end) {
            int h = rec[p] & 0xff;
            if (h == 0) break;
            int lb = h & 0x0f;
            int ob = h >>> 4;
            p++;
            if (lb == 0 || lb > 8 || ob > 8 || p + lb + ob > end) throw new IOException("Liste d'extents NTFS invalide");
            long len = 0;
            for (int i = 0; i < lb; i++) len |= (long) (rec[p + i] & 0xff) << (8 * i);
            p += lb;
            if (ob == 0) {
                out.add(new Run(vcn, len, -1));
            } else {
                long d = 0;
                for (int i = 0; i < ob; i++) d |= (long) (rec[p + i] & 0xff) << (8 * i);
                if ((rec[p + ob - 1] & 0x80) != 0 && ob < 8) d |= -1L << (8 * ob);
                p += ob;
                lcn += d;
                out.add(new Run(vcn, len, lcn));
            }
            vcn += len;
        }
    }

    private static List<Attr> select(List<Attr> all, int type, String name) {
        List<Attr> out = new ArrayList<>();
        for (Attr a : all) if (a.type == type && a.name.equals(name)) out.add(a);
        return out;
    }

    /** Attributs d'un type donné, y compris ceux répartis dans des enregistrements d'extension. */
    private List<Attr> gather(long recNo, byte[] rec, int type, String name) throws IOException {
        List<Attr> own = parseAttrs(rec);
        List<Attr> all = select(own, type, name);
        Attr list = null;
        for (Attr a : own) if (a.type == AT_ATTRLIST) list = a;
        if (list != null) {
            byte[] data;
            if (!list.nonResident) {
                data = list.resident;
            } else {
                Stream s = buildStream(Collections.singletonList(list));
                if (s.real > 16 * 1024 * 1024) throw new IOException("Liste d'attributs NTFS trop grande");
                data = new byte[(int) s.real];
                if (readStream(s, 0, data, 0, data.length) != data.length) throw new IOException("Liste d'attributs illisible");
            }
            Set<Long> seen = new HashSet<>();
            seen.add(recNo);
            for (int o = 0; o + 26 <= data.length; ) {
                int t = (int) Le.u32(data, o);
                int rl = Le.u16(data, o + 4);
                if (rl < 26) break;
                int nl = Le.u8(data, o + 6);
                int no = Le.u8(data, o + 7);
                long ref = Le.u64(data, o + 16) & 0xFFFFFFFFFFFFL;
                String nm = nl == 0 || o + no + nl * 2 > data.length ? "" : new String(data, o + no, nl * 2, StandardCharsets.UTF_16LE);
                if (t == type && nm.equals(name) && seen.add(ref)) {
                    all.addAll(select(parseAttrs(readRecord(ref)), type, name));
                }
                o += rl;
            }
        }
        Collections.sort(all, new Comparator<Attr>() {
            @Override public int compare(Attr a, Attr b) { return Long.compare(a.startVcn, b.startVcn); }
        });
        return all;
    }

    private static Stream buildStream(List<Attr> attrs) {
        if (attrs.isEmpty()) return null;
        Attr f = attrs.get(0);
        Stream s = new Stream();
        s.flags = f.flags;
        if (!f.nonResident) {
            s.resident = true;
            s.data = f.resident;
            s.real = s.init = f.resident.length;
            return s;
        }
        s.runs = new ArrayList<>();
        for (Attr a : attrs) s.runs.addAll(a.runs);
        s.real = f.real;
        s.init = f.init;
        return s;
    }

    private static Run findRun(List<Run> runs, long vcn) {
        int lo = 0, hi = runs.size() - 1;
        while (lo <= hi) {
            int mid = (lo + hi) >>> 1;
            Run r = runs.get(mid);
            if (vcn < r.vcn) hi = mid - 1;
            else if (vcn >= r.vcn + r.len) lo = mid + 1;
            else return r;
        }
        return null;
    }

    private int readStream(Stream s, long pos, byte[] dst, int off, int len) throws IOException {
        if (pos < 0) throw new IOException("Position invalide");
        if (len <= 0) return 0;
        if (pos >= s.real) return -1;
        int total = (int) Math.min((long) len, s.real - pos);
        if (s.resident) {
            System.arraycopy(s.data, (int) pos, dst, off, total);
            return total;
        }
        int done = 0;
        while (done < total) {
            long p = pos + done;
            long vcn = p / clusterBytes;
            Run r = findRun(s.runs, vcn);
            if (r == null) throw new IOException("Extent NTFS manquant (cluster virtuel " + vcn + ")");
            long runEnd = (r.vcn + r.len) * clusterBytes;
            int n = (int) Math.min((long) (total - done), runEnd - p);
            if (r.lcn < 0 || p >= s.init) {
                Arrays.fill(dst, off + done, off + done + n, (byte) 0);
            } else {
                n = (int) Math.min((long) n, s.init - p);
                src.read(r.lcn * clusterBytes + (p - r.vcn * clusterBytes), dst, off + done, n);
            }
            done += n;
        }
        return total;
    }

    // ---- dossiers --------------------------------------------------------------------------

    private static FsEntry fromFileName(byte[] b, int k, long ref) {
        int nameLen = Le.u8(b, k + 64);
        int nameType = Le.u8(b, k + 65);
        if (nameType == 2 || k + 66 + nameLen * 2 > b.length) return null;
        String name = new String(b, k + 66, nameLen * 2, StandardCharsets.UTF_16LE);
        long recNo = ref & 0xFFFFFFFFFFFFL;
        long flags = Le.u32(b, k + 56);
        if (name.equals(".") || recNo < 24 || (flags & 0x6) == 0x6) return null;
        boolean dir = (flags & 0x10000000L) != 0;
        return new FsEntry(name, dir, dir ? 0 : Le.u64(b, k + 48), recNo, 0, 0);
    }

    private static void parseNode(byte[] b, int nh, int limit, List<FsEntry> out, Deque<Long> pending) {
        int o = nh + (int) Le.u32(b, nh);
        int end = (int) Math.min((long) nh + Le.u32(b, nh + 4), (long) limit);
        while (o >= 0 && o + 16 <= end) {
            long ref = Le.u64(b, o);
            int el = Le.u16(b, o + 8);
            int kl = Le.u16(b, o + 10);
            int fl = Le.u16(b, o + 12);
            if (el < 16 || o + el > end) break;
            if ((fl & 1) != 0 && el >= 24) pending.add(Le.u64(b, o + el - 8));
            if ((fl & 2) == 0 && kl >= 66 && 16 + kl <= el) {
                FsEntry e = fromFileName(b, o + 16, ref);
                if (e != null) out.add(e);
            }
            if ((fl & 2) != 0) break;
            o += el;
        }
    }

    @Override public List<FsEntry> list(FsEntry dir) throws IOException {
        byte[] rec = readRecord(dir.id);
        if ((Le.u16(rec, 22) & 2) == 0) throw new IOException("Ce n'est pas un dossier NTFS");
        List<Attr> roots = gather(dir.id, rec, AT_INDEX_ROOT, "$I30");
        if (roots.isEmpty() || roots.get(0).resident == null || roots.get(0).resident.length < 32) return new ArrayList<>();
        byte[] ir = roots.get(0).resident;
        List<FsEntry> raw = new ArrayList<>();
        Deque<Long> pending = new ArrayDeque<>();
        parseNode(ir, 16, ir.length, raw, pending);
        if (!pending.isEmpty()) {
            Stream alloc = buildStream(gather(dir.id, rec, AT_INDEX_ALLOC, "$I30"));
            if (alloc != null && !alloc.resident) {
                long unit = idxSize >= clusterBytes ? clusterBytes : 512;
                Set<Long> seen = new HashSet<>();
                byte[] block = new byte[idxSize];
                while (!pending.isEmpty() && raw.size() < 500000) {
                    long vcn = pending.poll();
                    if (!seen.add(vcn)) continue;
                    if (readStream(alloc, vcn * unit, block, 0, idxSize) != idxSize) continue;
                    byte[] copy = block.clone();
                    applyFixups(copy, "INDX");
                    parseNode(copy, 24, idxSize, raw, pending);
                }
            }
        }
        List<FsEntry> out = new ArrayList<>();
        Set<String> dedupe = new HashSet<>();
        for (FsEntry e : raw) if (dedupe.add(e.id + "/" + e.name)) out.add(e);
        return out;
    }

    // ---- fichiers --------------------------------------------------------------------------

    @Override public FsFile open(FsEntry e) throws IOException {
        byte[] rec = readRecord(e.id);
        if ((Le.u16(rec, 22) & 1) == 0) throw new IOException("Ce fichier a été supprimé");
        final Stream s = buildStream(gather(e.id, rec, AT_DATA, ""));
        if (s == null) {
            return new FsFile() {
                @Override public long size() { return 0; }
                @Override public int read(long pos, byte[] dst, int off, int len) { return -1; }
            };
        }
        if ((s.flags & 0x0001) != 0) throw new IOException("Fichier compressé NTFS : non pris en charge");
        if ((s.flags & 0x4000) != 0) throw new IOException("Fichier chiffré (EFS) : lecture impossible");
        return new FsFile() {
            @Override public long size() { return s.real; }
            @Override public int read(long pos, byte[] dst, int off, int len) throws IOException {
                return readStream(s, pos, dst, off, len);
            }
        };
    }
}
