package com.transfert.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;

/**
 * Force les connexions de l'application à passer par le Wi-Fi. Sans cela, Android envoie parfois le trafic
 * par les données mobiles lorsque le Wi-Fi n'a pas d'accès Internet (box sans connexion, point d'accès local),
 * et le PC du réseau local devient « introuvable ».
 */
final class WifiBinder {
    private static Network bound;

    private WifiBinder() {}

    static void start(Context context) {
        try {
            final ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return;
            NetworkRequest request = new NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build();
            cm.registerNetworkCallback(request, new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network network) {
                    try { cm.bindProcessToNetwork(network); bound = network; } catch (Exception ignored) { /* non bloquant */ }
                }
                @Override public void onLost(Network network) {
                    try {
                        if (network.equals(bound)) { cm.bindProcessToNetwork(null); bound = null; }
                    } catch (Exception ignored) { /* non bloquant */ }
                }
            });
        } catch (Exception ignored) {
            // Sans cette liaison, Android choisit lui-même le réseau : le comportement reste celui d'avant.
        }
    }
}
