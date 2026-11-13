package com.transfert.app.usbfs;

import java.io.IOException;

/** Lecture d'un fichier stocké en chaîne de clusters (FAT) ou en clusters contigus (exFAT NoFatChain). */
final class ChainReader {
    interface Fat {
        long next(long cluster) throws IOException;
        boolean valid(long cluster);
        long offset(long cluster);
    }

    private final ByteSource src;
    private final Fat fat;
    private final long first;
    private final long clusterBytes;
    private final boolean contiguous;
    private long curIdx = -1;
    private long curCluster;

    ChainReader(ByteSource src, Fat fat, long first, long clusterBytes, boolean contiguous) {
        this.src = src;
        this.fat = fat;
        this.first = first;
        this.clusterBytes = clusterBytes;
        this.contiguous = contiguous;
    }

    private long seek(long idx) throws IOException {
        if (curIdx < 0 || idx < curIdx) { curIdx = 0; curCluster = first; }
        while (curIdx < idx) {
            long nx = fat.next(curCluster);
            if (!fat.valid(nx)) throw new IOException("Chaîne de clusters interrompue");
            curCluster = nx;
            curIdx++;
        }
        return curCluster;
    }

    int read(long pos, byte[] dst, int off, int len) throws IOException {
        int done = 0;
        while (done < len) {
            long p = pos + done;
            long idx = p / clusterBytes;
            int inCluster = (int) (p % clusterBytes);
            long cl = contiguous ? first + idx : seek(idx);
            if (!fat.valid(cl)) throw new IOException("Cluster invalide");
            int want = len - done;
            long runBytes = clusterBytes - inCluster;
            long last = cl;
            while (runBytes < want) {
                long nx = contiguous ? last + 1 : fat.next(last);
                if (nx != last + 1 || !fat.valid(nx)) break;
                last = nx;
                runBytes += clusterBytes;
            }
            int n = (int) Math.min((long) want, runBytes);
            src.read(fat.offset(cl) + inCluster, dst, off + done, n);
            done += n;
        }
        return done;
    }
}
