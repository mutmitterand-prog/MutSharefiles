package com.transfert.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;

/** Sonde réseau native : contourne les restrictions du WebView (contenu mixte, CORS) pour joindre le PC. */
@CapacitorPlugin(name = "Lan")
public class LanPlugin extends Plugin {
    @PluginMethod
    public void probe(final PluginCall call) {
        final String raw = call.getString("url");
        final int timeout = Math.max(1000, Math.min(20000, call.getInt("timeoutMs", 5000)));
        new Thread(new Runnable() {
            @Override public void run() {
                JSObject out = new JSObject();
                HttpURLConnection c = null;
                try {
                    URL url = new URL(raw);
                    if (!"http".equals(url.getProtocol()) && !"https".equals(url.getProtocol())) throw new IllegalArgumentException("Adresse invalide");
                    c = (HttpURLConnection) url.openConnection();
                    c.setConnectTimeout(timeout);
                    c.setReadTimeout(timeout);
                    c.setUseCaches(false);
                    c.setInstanceFollowRedirects(false);
                    int status = c.getResponseCode();
                    out.put("status", status);
                    if (status == 200) {
                        InputStream in = c.getInputStream();
                        ByteArrayOutputStream body = new ByteArrayOutputStream();
                        byte[] buf = new byte[1024];
                        int n;
                        while ((n = in.read(buf)) > 0 && body.size() < 8192) body.write(buf, 0, n);
                        in.close();
                        out.put("body", body.toString("UTF-8"));
                    }
                    out.put("ok", true);
                } catch (SocketTimeoutException e) {
                    out.put("ok", false);
                    out.put("reason", "timeout");
                    out.put("message", String.valueOf(e.getMessage()));
                } catch (NoRouteToHostException e) {
                    out.put("ok", false);
                    out.put("reason", "unreachable");
                    out.put("message", String.valueOf(e.getMessage()));
                } catch (UnknownHostException e) {
                    out.put("ok", false);
                    out.put("reason", "unreachable");
                    out.put("message", String.valueOf(e.getMessage()));
                } catch (Exception e) {
                    String m = String.valueOf(e.getMessage());
                    String reason = "error";
                    if (m.contains("ECONNREFUSED") || m.contains("refused")) reason = "refused";
                    else if (m.contains("ETIMEDOUT") || m.contains("timed out")) reason = "timeout";
                    else if (m.contains("EHOSTUNREACH") || m.contains("ENETUNREACH") || m.contains("No route") || m.contains("unreachable")) reason = "unreachable";
                    out.put("ok", false);
                    out.put("reason", reason);
                    out.put("message", m);
                } finally {
                    if (c != null) c.disconnect();
                }
                call.resolve(out);
            }
        }, "lan-probe").start();
    }
}
