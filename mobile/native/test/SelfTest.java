import com.transfert.app.usbfs.*;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/** Parcourt une image disque avec les pilotes USB et affiche « chemin \t taille \t sha256 » pour chaque fichier. */
public class SelfTest {
    static class FileDevice implements BlockDevice {
        final RandomAccessFile f; final int bs;
        FileDevice(String path, int bs) throws IOException { f = new RandomAccessFile(path, "r"); this.bs = bs; }
        public int blockSize() { return bs; }
        public long blockCount() { try { return f.length() / bs; } catch (IOException e) { throw new RuntimeException(e); } }
        public void readBlocks(long lba, int count, byte[] dst, int off) throws IOException { f.seek(lba * bs); f.readFully(dst, off, count * bs); }
    }

    /** Émule un support USB Bulk-Only (CBW/CSW) devant une image disque. */
    static class FakeBot implements BulkTransport {
        final RandomAccessFile f; final int bs; final boolean fail;
        byte[] pending = new byte[0]; int pos = 0; int cmds = 0, maxChunk = 0;
        FakeBot(String path, int bs) throws IOException { f = new RandomAccessFile(path, "r"); this.bs = bs; this.fail = false; }
        public int bulkOut(byte[] b, int off, int len, int t) {
            try {
                if (len != 31 || (b[off] & 0xff) != 0x55) return len;
                int op = b[off + 15] & 0xff; byte[] data = new byte[0]; int status = 0;
                long total = f.length() / bs;
                if (op == 0x00) { cmds++; if (cmds < 3) status = 1; }          // le disque « démarre » : 2 premières TUR refusées
                else if (op == 0x03) data = new byte[18];
                else if (op == 0x25) { data = new byte[8]; long last = total - 1; for (int i = 0; i < 4; i++) data[i] = (byte) (last >> (24 - 8 * i)); for (int i = 0; i < 4; i++) data[4 + i] = (byte) (bs >> (24 - 8 * i)); }
                else if (op == 0x28 || op == 0x88) {
                    long lba = 0; int n;
                    if (op == 0x28) { for (int i = 0; i < 4; i++) lba = (lba << 8) | (b[off + 17 + i] & 0xff); n = ((b[off + 22] & 0xff) << 8) | (b[off + 23] & 0xff); }
                    else { for (int i = 0; i < 8; i++) lba = (lba << 8) | (b[off + 17 + i] & 0xff); n = ((b[off + 25] & 0xff) << 24) | ((b[off + 26] & 0xff) << 16) | ((b[off + 27] & 0xff) << 8) | (b[off + 28] & 0xff); }
                    data = new byte[n * bs]; f.seek(lba * bs); f.readFully(data);
                }
                byte[] csw = new byte[13]; csw[0] = 'U'; csw[1] = 'S'; csw[2] = 'B'; csw[3] = 'S'; System.arraycopy(b, off + 4, csw, 4, 4); csw[12] = (byte) status;
                if (status != 0) data = new byte[0];
                pending = new byte[data.length + 13]; System.arraycopy(data, 0, pending, 0, data.length); System.arraycopy(csw, 0, pending, data.length, 13); pos = 0;
                return len;
            } catch (IOException e) { return -1; }
        }
        public int bulkIn(byte[] b, int off, int len, int t) {
            maxChunk = Math.max(maxChunk, len);
            if (len > 16384) throw new IllegalStateException("bulkIn > 16 Ko : " + len);
            int n = Math.min(len, pending.length - pos); if (n <= 0) return -1;
            System.arraycopy(pending, pos, b, off, n); pos += n; return n;
        }
        public void clearHalt(boolean in) {}
        public boolean resetRecovery() { return true; }
        public int maxPacket(boolean in) { return 512; }
    }

    static void walk(FileSystemReader fs, FsEntry dir, String prefix, List<String> out) throws Exception {
        List<FsEntry> list = fs.list(dir);
        Collections.sort(list, new Comparator<FsEntry>() { public int compare(FsEntry a, FsEntry b) { return a.name.compareTo(b.name); } });
        for (FsEntry e : list) {
            String path = prefix + e.name;
            if (e.directory) { walk(fs, e, path + "/", out); continue; }
            try {
                FsFile f = fs.open(e);
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                byte[] buf = new byte[70000]; long pos = 0; int n;
                while ((n = f.read(pos, buf, 0, buf.length)) > 0) { md.update(buf, 0, n); pos += n; }
                StringBuilder sb = new StringBuilder(); for (byte x : md.digest()) sb.append(String.format("%02x", x));
                out.add(path + "\t" + f.size() + "\t" + sb);
                if (pos != f.size()) out.add("!! taille lue " + pos + " != " + f.size() + " pour " + path);
            } catch (IOException ex) { out.add(path + "\tERR\t" + ex.getMessage()); }
        }
    }

    public static void main(String[] a) throws Exception {
        int bs = a.length > 1 ? Integer.parseInt(a[1]) : 512;
        boolean scsi = a.length > 2 && a[2].equals("scsi");
        BlockDevice dev; if (scsi) { FakeBot bot = new FakeBot(a[0], bs); dev = new ScsiBlockDevice(bot); } else dev = new FileDevice(a[0], bs);
        List<String> notes = new ArrayList<>();
        List<VolumeScanner.Volume> vols = VolumeScanner.scan(dev, notes);
        System.out.println("#volumes\t" + vols.size());
        for (String n : notes) System.out.println("#note\t" + n);
        for (VolumeScanner.Volume v : vols) {
            System.out.println("#volume\t" + v.title);
            List<String> out = new ArrayList<>(); walk(v.fs, v.fs.root(), "", out); for (String s : out) System.out.println(s);
        }
    }
}
