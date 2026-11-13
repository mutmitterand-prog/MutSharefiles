package com.transfert.app.usbfs;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/** Lecture par octets au-dessus d'un BlockDevice, avec petit cache de blocs ; peut représenter une partition. */
public final class ByteSource {
    private static final class Root {
        final BlockDevice dev;
        final int bs;
        final int maxBlocks;
        final LinkedHashMap<Long, byte[]> cache = new LinkedHashMap<Long, byte[]>(128, 0.75f, true) {
            @Override protected boolean removeEldestEntry(Map.Entry<Long, byte[]> eldest) { return size() > 256; }
        };
        Root(BlockDevice dev) {
            this.dev = dev;
            this.bs = dev.blockSize();
            this.maxBlocks = Math.max(1, (256 * 1024) / bs);
        }
    }

    private final Root root;
    private final long base;
    private final long length;

    public ByteSource(BlockDevice dev) { this(new Root(dev), 0, dev.blockCount() * (long) dev.blockSize()); }
    private ByteSource(Root root, long base, long length) { this.root = root; this.base = base; this.length = length; }

    public ByteSource slice(long offset, long len) {
        if (offset < 0 || len < 0 || offset > length) throw new IllegalArgumentException("Partition hors du support");
        return new ByteSource(root, base + offset, Math.min(len, length - offset));
    }

    public long length() { return length; }
    public int blockSize() { return root.bs; }

    /** Lit jusqu'à len octets ; retourne le nombre d'octets lus (0 si pos est au-delà de la fin). */
    public int read(long pos, byte[] dst, int off, int len) throws IOException {
        if (pos < 0 || len < 0) throw new IOException("Lecture invalide");
        if (pos >= length || len == 0) return 0;
        if (len > length - pos) len = (int) (length - pos);
        synchronized (root) {
            int done = 0;
            while (done < len) {
                long abs = base + pos + done;
                long lba = abs / root.bs;
                int inBlock = (int) (abs % root.bs);
                int remaining = len - done;
                if (inBlock == 0 && remaining >= root.bs) {
                    int blocks = Math.min(remaining / root.bs, root.maxBlocks);
                    root.dev.readBlocks(lba, blocks, dst, off + done);
                    done += blocks * root.bs;
                } else {
                    byte[] b = root.cache.get(lba);
                    if (b == null) {
                        b = new byte[root.bs];
                        root.dev.readBlocks(lba, 1, b, 0);
                        root.cache.put(lba, b);
                    }
                    int n = Math.min(root.bs - inBlock, remaining);
                    System.arraycopy(b, inBlock, dst, off + done, n);
                    done += n;
                }
            }
            return len;
        }
    }

    public byte[] readFully(long pos, int len) throws IOException {
        byte[] b = new byte[len];
        if (read(pos, b, 0, len) != len) throw new IOException("Fin du support atteinte");
        return b;
    }
}
