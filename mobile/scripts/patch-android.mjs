// Adapte le projet Android généré par « npx cap add android » :
// permission caméra, trafic HTTP local, téléchargements natifs et numéro de version.
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
if (!manifest.includes('android.permission.CAMERA')) {
  const permissions = `    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
`;
  manifest = mustReplace(manifest, '</manifest>', `${permissions}</manifest>`, 'permissions');
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

// --- build.gradle : version
let gradle = fs.readFileSync(gradlePath, 'utf8');
const versionName = process.env.APP_VERSION || '1.0.0';
const versionCode = process.env.APP_VERSION_CODE || '1';
gradle = mustReplace(gradle, /versionCode \d+/, `versionCode ${versionCode}`, 'versionCode');
gradle = mustReplace(gradle, /versionName "[^"]*"/, `versionName "${versionName}"`, 'versionName');
fs.writeFileSync(gradlePath, gradle);

console.log(`Projet Android adapté : version ${versionName} (code ${versionCode}).`);
