package com.transfert.app.usbfs;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Détecte les partitions (MBR, GPT, disque sans table) et ouvre celles dont le système de fichiers est géré. */
public final class VolumeScanner {
    private VolumeScanner() {}

    public static final class Volume {
        public final FileSystemReader fs;
        public final String title;
        public final long sizeBytes;
        Volume(FileSystemReader fs, String title, long sizeBytes) { this.fs = fs; this.title = title; this.sizeBytes = sizeBytes; }
    }

    private static final class Part {
        final long startLba, sectors;
        final String hint;
        Part(long startLba, long sectors, String hint) { this.startLba = startLba; this.sectors = sectors; this.hint = hint; }
    }

    public static String humanSize(long bytes) {
        String[] u = {"o", "Ko", "Mo", "Go", "To"};
        double n = bytes;
        int i = 0;
        while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
        return (i == 0 ? String.valueOf((long) n) : String.format(java.util.Locale.FRANCE, "%.1f", n)) + " " + u[i];
    }

    /** Ouvre le système de fichiers d'une partition ; null (avec une note) s'il n'est pas géré. */
    static FileSystemReader openFileSystem(ByteSource part, String where, List<String> notes) {
        try {
            byte[] v = part.readFully(0, 512);
            if (NtfsFs.matches(v)) return new NtfsFs(part, v);
            if (ExFatFs.matches(v)) return new ExFatFs(part, v);
            String oem = new String(v, 3, 8, StandardCharsets.ISO_8859_1);
            if (oem.startsWith("-FVE-FS-")) { notes.add(where + " : volume chiffré BitLocker — déverrouillez-le sur un PC."); return null; }
            if (oem.startsWith("ReFS")) { notes.add(where + " : ReFS n'est pas pris en charge."); return null; }
            if (FatFs.matches(v)) return new FatFs(part, v);
            byte[] sb = part.length() >= 1082 ? part.readFully(1024, 64) : null;
            if (sb != null && Le.u16(sb, 56) == 0xEF53) notes.add(where + " : système de fichiers Linux (ext) non pris en charge.");
        } catch (IOException | RuntimeException e) {
            notes.add(where + " : lecture impossible (" + e.getMessage() + ").");
        }
        return null;
    }

    private static void addExtended(ByteSource whole, int bs, long extStart, List<Part> out) throws IOException {
        long ebr = extStart;
        for (int guard = 0; guard < 64; guard++) {
            byte[] s = whole.readFully(ebr * bs, 512);
            if (Le.u16(s, 510) != 0xAA55) return;
            int type = Le.u8(s, 446 + 4);
            long lba = Le.u32(s, 446 + 8);
            long cnt = Le.u32(s, 446 + 12);
            if (type != 0 && cnt > 0) out.add(new Part(ebr + lba, cnt, String.format("type 0x%02X", type)));
            int nextType = Le.u8(s, 462 + 4);
            long nextLba = Le.u32(s, 462 + 8);
            if (nextType == 0 || nextLba == 0) return;
            ebr = extStart + nextLba;
        }
    }

    public static List<Volume> scan(BlockDevice dev, List<String> notes) throws IOException {
        ByteSource whole = new ByteSource(dev);
        int bs = dev.blockSize();
        List<Volume> vols = new ArrayList<>();
        byte[] first = whole.readFully(0, 512);

        FileSystemReader direct = null;
        String oem = new String(first, 3, 8, StandardCharsets.ISO_8859_1);
        boolean fatLabel = new String(first, 54, 3, StandardCharsets.ISO_8859_1).equals("FAT")
                || new String(first, 82, 3, StandardCharsets.ISO_8859_1).equals("FAT");
        if (NtfsFs.matches(first) || ExFatFs.matches(first) || oem.startsWith("-FVE-FS-") || (FatFs.matches(first) && fatLabel)) {
            direct = openFileSystem(whole, "Disque", notes);
        }
        if (direct != null) {
            vols.add(new Volume(direct, titleFor(direct, whole.length()), whole.length()));
            return vols;
        }

        List<Part> parts = new ArrayList<>();
        boolean gpt = false;
        if (Le.u16(first, 510) == 0xAA55) {
            for (int i = 0; i < 4; i++) {
                int o = 446 + 16 * i;
                int type = Le.u8(first, o + 4);
                long lba = Le.u32(first, o + 8);
                long cnt = Le.u32(first, o + 12);
                if (type == 0 || cnt == 0) continue;
                if (type == 0xEE) { gpt = true; continue; }
                if (type == 0x05 || type == 0x0F || type == 0x85) { addExtended(whole, bs, lba, parts); continue; }
                parts.add(new Part(lba, cnt, String.format("type 0x%02X", type)));
            }
        }
        if (gpt) {
            parts.clear();
            byte[] h = whole.readFully(bs, 92);
            if (!"EFI PART".equals(new String(h, 0, 8, StandardCharsets.ISO_8859_1))) {
                notes.add("Table de partitions GPT illisible.");
            } else {
                long entriesLba = Le.u64(h, 72);
                long n = Le.u32(h, 80);
                long size = Le.u32(h, 84);
                if (size < 128 || n * size > 1024 * 1024) throw new IOException("Table GPT invalide");
                byte[] t = whole.readFully(entriesLba * bs, (int) (n * size));
                for (int i = 0; i < n; i++) {
                    int o = (int) (i * size);
                    boolean used = false;
                    for (int k = 0; k < 16; k++) if (t[o + k] != 0) { used = true; break; }
                    if (!used) continue;
                    long firstLba = Le.u64(t, o + 32);
                    long lastLba = Le.u64(t, o + 40);
                    if (lastLba < firstLba) continue;
                    String name = new String(t, o + 56, 72, StandardCharsets.UTF_16LE).replace("\u0000", "").trim();
                    parts.add(new Part(firstLba, lastLba - firstLba + 1, name.isEmpty() ? "GPT" : name));
                }
            }
        }

        int index = 0;
        for (Part p : parts) {
            index++;
            long off = p.startLba * bs;
            if (off >= whole.length()) { notes.add("Partition " + index + " : hors du support."); continue; }
            ByteSource slice = whole.slice(off, p.sectors * bs);
            FileSystemReader fs = openFileSystem(slice, "Partition " + index + " (" + p.hint + ")", notes);
            if (fs != null) vols.add(new Volume(fs, "Partition " + index + " — " + titleFor(fs, slice.length()), slice.length()));
        }
        if (vols.isEmpty() && notes.isEmpty()) notes.add("Aucune partition FAT32, exFAT ou NTFS lisible n'a été trouvée sur ce support.");
        return vols;
    }

    private static String titleFor(FileSystemReader fs, long size) {
        String label = fs.label().trim();
        return fs.type() + (label.isEmpty() ? "" : " « " + label + " »") + " — " + humanSize(size);
    }
}
