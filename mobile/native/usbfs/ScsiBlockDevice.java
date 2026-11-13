package com.transfert.app.usbfs;

import java.io.IOException;

/** Support de stockage USB « Bulk-Only » (clés, disques durs) lu par commandes SCSI READ. */
public final class ScsiBlockDevice implements BlockDevice {
    private static final int CHUNK = 16384;
    private static final int INIT_TIMEOUT_MS = 5000;
    private static final int IO_TIMEOUT_MS = 15000;
    private static final long READY_WAIT_MS = 40000;

    /** Reçoit l'étape en cours (affichée à l'écran pendant le démarrage du disque). */
    public interface StatusListener { void onStatus(String text); }

    private final BulkTransport t;
    private final StatusListener listener;
    private volatile int timeoutMs = INIT_TIMEOUT_MS;
    private int blockSize;
    private long blockCount;
    private int tag = 0x1000;

    public ScsiBlockDevice(BulkTransport transport) throws IOException { this(transport, null); }

    public ScsiBlockDevice(BulkTransport transport, StatusListener listener) throws IOException {
        this.t = transport;
        this.listener = listener;
        init();
    }

    private void status(String text) { if (listener != null) listener.onStatus(text); }

    private static String describeSense(int[] s) {
        String[] keys = {"aucune erreur", "erreur récupérée", "pas prêt", "erreur du support", "erreur matérielle", "commande refusée", "changement d'état", "protégé"};
        String key = s[0] < keys.length ? keys[s[0]] : "clé " + s[0];
        return key + String.format(" (SCSI %02X/%02X/%02X)", s[0], s[1], s[2]);
    }

    @Override public int blockSize() { return blockSize; }
    @Override public long blockCount() { return blockCount; }

    private static final class ScsiFailure extends IOException {
        final int senseKey;
        ScsiFailure(String m, int senseKey) { super(m); this.senseKey = senseKey; }
    }

    private void init() throws IOException {
        status("Initialisation du support USB…");
        t.resetRecovery();
        long deadline = System.currentTimeMillis() + READY_WAIT_MS;
        String diag = "aucune réponse du support";
        boolean ready = false;
        while (!ready && System.currentTimeMillis() < deadline) {
            try {
                command(new byte[6], null, 0, 0, false);
                ready = true;
            } catch (ScsiFailure e) {
                diag = "support pas prêt";
                try { diag = describeSense(requestSense()); } catch (IOException ignored) { diag += " (détail indisponible)"; }
                status("Démarrage du disque… " + diag);
                sleep(1000);
            } catch (IOException e) {
                diag = e.getMessage();
                status("Le support ne répond pas encore… " + diag);
                sleep(500);
            }
        }
        if (!ready) {
            throw new IOException("le support ne répond pas (" + diag + "). Un disque dur ou SSD a souvent besoin de sa propre alimentation (boîtier alimenté ou hub USB alimenté) ; vérifiez aussi le câble puis rebranchez");
        }
        status("Lecture de la capacité du support…");
        timeoutMs = IO_TIMEOUT_MS;

        byte[] cap = new byte[8];
        command(new byte[]{0x25, 0, 0, 0, 0, 0, 0, 0, 0, 0}, cap, 0, 8, true);
        long last10 = Le.be32(cap, 0);
        blockSize = (int) Le.be32(cap, 4);
        if (last10 == 0xFFFFFFFFL) {
            byte[] cap16 = new byte[32];
            byte[] cdb = new byte[16];
            cdb[0] = (byte) 0x9E;
            cdb[1] = 0x10;
            cdb[13] = 32;
            command(cdb, cap16, 0, 32, true);
            blockCount = Le.be64(cap16, 0) + 1;
            blockSize = (int) Le.be32(cap16, 8);
        } else {
            blockCount = last10 + 1;
        }
        if (blockSize < 512 || blockSize > 65536 || (blockSize & (blockSize - 1)) != 0) {
            throw new IOException("Taille de bloc USB inattendue : " + blockSize);
        }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }

    private int[] requestSense() throws IOException {
        byte[] s = new byte[18];
        command(new byte[]{0x03, 0, 0, 0, 18, 0}, s, 0, 18, true);
        return new int[]{s[2] & 0x0f, s[12] & 0xff, s[13] & 0xff};
    }

    private static void put32le(byte[] b, int o, long v) {
        b[o] = (byte) v; b[o + 1] = (byte) (v >> 8); b[o + 2] = (byte) (v >> 16); b[o + 3] = (byte) (v >> 24);
    }

    private void recover() {
        t.resetRecovery();
        t.clearHalt(true);
        t.clearHalt(false);
    }

    private synchronized void command(byte[] cdb, byte[] data, int off, int len, boolean in) throws IOException {
        byte[] cbw = new byte[31];
        int myTag = ++tag;
        put32le(cbw, 0, 0x43425355L);
        put32le(cbw, 4, myTag);
        put32le(cbw, 8, len);
        cbw[12] = (byte) (in ? 0x80 : 0x00);
        cbw[14] = (byte) cdb.length;
        System.arraycopy(cdb, 0, cbw, 15, cdb.length);
        if (t.bulkOut(cbw, 0, cbw.length, timeoutMs) != cbw.length) {
            recover();
            throw new IOException("Envoi de la commande USB impossible");
        }
        int transferred = 0;
        if (len > 0) {
            boolean stalled = false;
            int packet = Math.max(64, t.maxPacket(in));
            while (transferred < len) {
                int chunk = Math.min(CHUNK, len - transferred);
                int r = in ? t.bulkIn(data, off + transferred, chunk, timeoutMs) : t.bulkOut(data, off + transferred, chunk, timeoutMs);
                if (r < 0) { stalled = true; break; }
                if (r == 0) break;
                transferred += r;
                if (in && r < chunk && r % packet != 0) break;
            }
            if (stalled) t.clearHalt(in);
        }
        byte[] csw = new byte[13];
        int r = t.bulkIn(csw, 0, 13, timeoutMs);
        if (r != 13) {
            t.clearHalt(true);
            r = t.bulkIn(csw, 0, 13, timeoutMs);
        }
        if (r != 13 || Le.u32(csw, 0) != 0x53425355L) { recover(); throw new IOException("Réponse USB invalide"); }
        if (Le.u32(csw, 4) != myTag) { recover(); throw new IOException("Désynchronisation USB"); }
        int status = csw[12] & 0xff;
        if (status == 2) { recover(); throw new IOException("Erreur de protocole USB"); }
        if (status != 0) throw new ScsiFailure("Commande SCSI refusée par le support", 0);
        if (len > 0 && transferred < len && in) throw new IOException("Données USB incomplètes (" + transferred + "/" + len + ")");
    }

    @Override public void readBlocks(long lba, int count, byte[] dst, int off) throws IOException {
        if (lba < 0 || count <= 0 || lba + count > blockCount) throw new IOException("Lecture hors du support");
        int done = 0;
        while (done < count) {
            int n = Math.min(count - done, Math.max(1, (1024 * 1024) / blockSize));
            n = Math.min(n, 65535);
            long cur = lba + done;
            byte[] cdb;
            if (cur + n <= 0xFFFFFFFFL) {
                cdb = new byte[]{0x28, 0, (byte) (cur >> 24), (byte) (cur >> 16), (byte) (cur >> 8), (byte) cur, 0, (byte) (n >> 8), (byte) n, 0};
            } else {
                cdb = new byte[16];
                cdb[0] = (byte) 0x88;
                for (int i = 0; i < 8; i++) cdb[2 + i] = (byte) (cur >> (56 - 8 * i));
                cdb[10] = (byte) (n >> 24); cdb[11] = (byte) (n >> 16); cdb[12] = (byte) (n >> 8); cdb[13] = (byte) n;
            }
            IOException failure = null;
            for (int attempt = 0; attempt < 3; attempt++) {
                try {
                    command(cdb, dst, off + done * blockSize, n * blockSize, true);
                    failure = null;
                    break;
                } catch (ScsiFailure e) {
                    failure = e;
                    try { requestSense(); } catch (IOException ignored) { /* ignoré */ }
                } catch (IOException e) {
                    failure = e;
                }
                sleep(200);
            }
            if (failure != null) throw new IOException("Erreur de lecture du support (secteur " + cur + ") : " + failure.getMessage());
            done += n;
        }
    }
}
