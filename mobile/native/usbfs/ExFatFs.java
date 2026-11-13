package com.transfert.app.usbfs;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** exFAT, lecture seule. */
public final class ExFatFs implements FileSystemReader, ChainReader.Fat {
    private final ByteSource src;
    private final long clusterBytes;
    private final long fatStart;
    private final long heapStart;
    private final long clusterCount;
    private final long rootCluster;
    private String label = "";

    static boolean matches(byte[] v) {
        return v.length >= 11 && "EXFAT   ".equals(new String(v, 3, 8, StandardCharsets.ISO_8859_1));
    }

    public ExFatFs(ByteSource src, byte[] v) throws IOException {
        this.src = src;
        int bpsShift = Le.u8(v, 108);
        int spcShift = Le.u8(v, 109);
        if (bpsShift < 9 || bpsShift > 12 || spcShift > 25 - bpsShift) throw new IOException("Paramètres exFAT invalides");
        long bps = 1L << bpsShift;
        clusterBytes = bps << spcShift;
        fatStart = Le.u32(v, 80) * bps;
        heapStart = Le.u32(v, 88) * bps;
        clusterCount = Le.u32(v, 92);
        rootCluster = Le.u32(v, 96);
        if (!valid(rootCluster)) throw new IOException("Racine exFAT invalide");
        try { list(root()); } catch (IOException ignored) { /* le libellé est facultatif */ }
    }

    @Override public String type() { return "exFAT"; }
    @Override public String label() { return label; }
    @Override public FsEntry root() { return new FsEntry("", true, 0, rootCluster, 0, 0); }

    @Override public long next(long c) throws IOException { return Le.u32(src.readFully(fatStart + c * 4, 4), 0); }
    @Override public boolean valid(long c) { return c >= 2 && c < clusterCount + 2; }
    @Override public long offset(long c) { return heapStart + (c - 2) * clusterBytes; }

    private byte[] readDir(FsEntry dir) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        boolean contiguous = dir.flags == 1;
        long limit = dir.size > 0 ? dir.size : Long.MAX_VALUE;
        long got = 0;
        long c = dir.id;
        long steps = 0;
        while (valid(c) && got < limit && steps++ <= clusterCount) {
            int n = (int) Math.min(clusterBytes, limit - got);
            out.write(src.readFully(offset(c), n));
            got += n;
            if (got > 64L * 1024 * 1024) throw new IOException("Dossier exFAT trop volumineux");
            c = contiguous ? c + 1 : next(c);
        }
        return out.toByteArray();
    }

    @Override public List<FsEntry> list(FsEntry dir) throws IOException {
        byte[] d = readDir(dir);
        List<FsEntry> out = new ArrayList<>();
        for (int o = 0; o + 32 <= d.length; o += 32) {
            int t = d[o] & 0xff;
            if (t == 0x00) break;
            if (t == 0x83) {
                int chars = Math.min(11, d[o + 1] & 0xff);
                label = new String(d, o + 2, chars * 2, StandardCharsets.UTF_16LE);
                continue;
            }
            if (t != 0x85) continue;
            int secondary = d[o + 1] & 0xff;
            int attr = Le.u16(d, o + 4);
            if (secondary < 2 || o + 32 * (secondary + 1) > d.length) continue;
            int s = o + 32;
            if ((d[s] & 0xff) != 0xC0) continue;
            int streamFlags = d[s + 1] & 0xff;
            int nameLen = d[s + 3] & 0xff;
            long valid = Le.u64(d, s + 8);
            long first = Le.u32(d, s + 20);
            long length = Le.u64(d, s + 24);
            StringBuilder name = new StringBuilder();
            for (int k = 2; k <= secondary && name.length() < nameLen; k++) {
                int e = o + 32 * k;
                if ((d[e] & 0xff) != 0xC1) break;
                int take = Math.min(15, nameLen - name.length());
                name.append(new String(d, e + 2, take * 2, StandardCharsets.UTF_16LE));
            }
            o += 32 * secondary;
            boolean hiddenSystem = (attr & 0x06) == 0x06;
            if (hiddenSystem || name.length() == 0) continue;
            boolean isDir = (attr & 0x10) != 0;
            out.add(new FsEntry(name.toString(), isDir, isDir ? length : length, first, valid, (streamFlags & 0x02) != 0 ? 1 : 0));
        }
        return out;
    }

    @Override public FsFile open(FsEntry e) throws IOException {
        final long size = e.size;
        final long valid = Math.min(e.aux, e.size);
        final ChainReader chain = new ChainReader(src, this, e.id, clusterBytes, e.flags == 1);
        return new FsFile() {
            @Override public long size() { return size; }
            @Override public int read(long pos, byte[] dst, int off, int len) throws IOException {
                if (pos >= size) return -1;
                int n = (int) Math.min((long) len, size - pos);
                if (n <= 0) return 0;
                if (pos >= valid) { Arrays.fill(dst, off, off + n, (byte) 0); return n; }
                int real = (int) Math.min((long) n, valid - pos);
                chain.read(pos, dst, off, real);
                if (real < n) Arrays.fill(dst, off + real, off + n, (byte) 0);
                return n;
            }
        };
    }
}
