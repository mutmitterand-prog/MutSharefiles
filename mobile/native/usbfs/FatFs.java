package com.transfert.app.usbfs;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** FAT16 et FAT32, lecture seule (noms longs pris en charge). */
public final class FatFs implements FileSystemReader, ChainReader.Fat {
    private final ByteSource src;
    private final boolean fat32;
    private final long fatStart;
    private final long dataStart;
    private final long clusterBytes;
    private final long clusterCount;
    private final long rootCluster;
    private final long rootDirStart;
    private final int rootDirBytes;
    private String label;

    static boolean matches(byte[] v) {
        if (v.length < 512 || Le.u8(v, 510) != 0x55 || Le.u8(v, 511) != 0xAA) return false;
        int bps = Le.u16(v, 11);
        int spc = Le.u8(v, 13);
        int reserved = Le.u16(v, 14);
        int fats = Le.u8(v, 16);
        boolean bpsOk = bps == 512 || bps == 1024 || bps == 2048 || bps == 4096;
        return bpsOk && spc != 0 && (spc & (spc - 1)) == 0 && reserved > 0 && (fats == 1 || fats == 2);
    }

    public FatFs(ByteSource src, byte[] v) throws IOException {
        this.src = src;
        int bps = Le.u16(v, 11);
        int spc = Le.u8(v, 13);
        int reserved = Le.u16(v, 14);
        int fats = Le.u8(v, 16);
        int rootEntries = Le.u16(v, 17);
        long total = Le.u16(v, 19) != 0 ? Le.u16(v, 19) : Le.u32(v, 32);
        long fatSize = Le.u16(v, 22) != 0 ? Le.u16(v, 22) : Le.u32(v, 36);
        long rootSectors = ((long) rootEntries * 32 + bps - 1) / bps;
        long dataSectors = total - (reserved + fats * fatSize + rootSectors);
        clusterCount = dataSectors / spc;
        if (dataSectors <= 0 || fatSize <= 0) throw new IOException("Paramètres FAT invalides");
        if (clusterCount < 4085) throw new IOException("FAT12 non pris en charge");
        fat32 = clusterCount >= 65525;
        clusterBytes = (long) bps * spc;
        fatStart = (long) reserved * bps;
        rootDirStart = (reserved + fats * fatSize) * bps;
        rootDirBytes = rootEntries * 32;
        dataStart = (reserved + fats * fatSize + rootSectors) * bps;
        rootCluster = fat32 ? Le.u32(v, 44) : 0;
        String bpb = new String(v, fat32 ? 71 : 43, 11, StandardCharsets.ISO_8859_1).trim();
        label = bpb.equalsIgnoreCase("NO NAME") ? "" : bpb;
    }

    @Override public String type() { return fat32 ? "FAT32" : "FAT16"; }
    @Override public String label() { return label; }
    @Override public FsEntry root() { return new FsEntry("", true, 0, rootCluster, 0, 0); }

    @Override public long next(long c) throws IOException {
        if (fat32) return Le.u32(src.readFully(fatStart + c * 4, 4), 0) & 0x0FFFFFFFL;
        return Le.u16(src.readFully(fatStart + c * 2, 2), 0);
    }
    @Override public boolean valid(long c) { return c >= 2 && c < clusterCount + 2; }
    @Override public long offset(long c) { return dataStart + (c - 2) * clusterBytes; }

    private byte[] readDir(long first) throws IOException {
        if (!fat32 && first == 0) return src.readFully(rootDirStart, rootDirBytes);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        long c = first;
        long steps = 0;
        while (valid(c) && steps++ <= clusterCount) {
            out.write(src.readFully(offset(c), (int) clusterBytes));
            if (out.size() > 32 * 1024 * 1024) throw new IOException("Dossier FAT trop volumineux");
            c = next(c);
        }
        return out.toByteArray();
    }

    @Override public List<FsEntry> list(FsEntry dir) throws IOException {
        byte[] d = readDir(dir.id);
        List<FsEntry> out = new ArrayList<>();
        char[] lfn = null;
        int lfnSeqs = 0;
        for (int o = 0; o + 32 <= d.length; o += 32) {
            int first = d[o] & 0xff;
            if (first == 0x00) break;
            if (first == 0xE5) { lfn = null; continue; }
            int attr = d[o + 11] & 0xff;
            if (attr == 0x0F) {
                int seq = first & 0x1F;
                if ((first & 0x40) != 0) {
                    lfnSeqs = seq;
                    lfn = new char[Math.max(1, seq) * 13];
                    java.util.Arrays.fill(lfn, '\uffff');
                }
                if (lfn == null || seq < 1 || seq > lfnSeqs) { lfn = null; continue; }
                int base = (seq - 1) * 13;
                int k = 0;
                for (int i = 1; i < 11; i += 2) lfn[base + k++] = (char) Le.u16(d, o + i);
                for (int i = 14; i < 26; i += 2) lfn[base + k++] = (char) Le.u16(d, o + i);
                for (int i = 28; i < 32; i += 2) lfn[base + k++] = (char) Le.u16(d, o + i);
                continue;
            }
            if ((attr & 0x08) != 0) {
                if ((attr & 0x10) == 0 && label.isEmpty()) {
                    label = new String(d, o, 11, StandardCharsets.ISO_8859_1).trim();
                }
                lfn = null;
                continue;
            }
            String name;
            if (lfn != null) {
                int n = 0;
                while (n < lfn.length && lfn[n] != 0 && lfn[n] != '\uffff') n++;
                name = new String(lfn, 0, n);
            } else {
                byte[] b = new byte[11];
                System.arraycopy(d, o, b, 0, 11);
                if ((b[0] & 0xff) == 0x05) b[0] = (byte) 0xE5;
                String base = new String(b, 0, 8, StandardCharsets.ISO_8859_1).trim();
                String ext = new String(b, 8, 3, StandardCharsets.ISO_8859_1).trim();
                int caseFlags = d[o + 12] & 0xff;
                if ((caseFlags & 0x08) != 0) base = base.toLowerCase();
                if ((caseFlags & 0x10) != 0) ext = ext.toLowerCase();
                name = ext.isEmpty() ? base : base + "." + ext;
            }
            lfn = null;
            if (name.equals(".") || name.equals("..") || name.isEmpty()) continue;
            long cluster = ((long) Le.u16(d, o + 20) << 16) | Le.u16(d, o + 26);
            long size = Le.u32(d, o + 28);
            boolean isDir = (attr & 0x10) != 0;
            out.add(new FsEntry(name, isDir, isDir ? 0 : size, cluster, 0, 0));
        }
        return out;
    }

    @Override public FsFile open(FsEntry e) throws IOException {
        final long size = e.size;
        final ChainReader chain = new ChainReader(src, this, e.id, clusterBytes, false);
        return new FsFile() {
            @Override public long size() { return size; }
            @Override public int read(long pos, byte[] dst, int off, int len) throws IOException {
                if (pos >= size) return -1;
                int n = (int) Math.min((long) len, size - pos);
                if (n <= 0) return 0;
                return chain.read(pos, dst, off, n);
            }
        };
    }
}
