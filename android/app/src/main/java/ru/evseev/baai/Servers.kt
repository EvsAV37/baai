// «Баай» — серверы на телефоне хоста.
// WebServer раздаёт игру (папка assets/www) на порту 8080.
// Relay пересылает сообщения между хостом (WebView) и игроками на порту 8081.
// Правил здесь нет: всю игру считает JavaScript в WebView хоста.
// Тот же протокол в tools/relay.js (для проверки на компьютере).
// © 2026 Евсеев А.В.
package ru.evseev.baai

import android.content.res.AssetManager
import android.util.Log
import fi.iki.elonen.NanoHTTPD
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.util.Collections

const val HTTP_PORT = 8080
const val WS_PORT = 8081
private const val TAG = "Baai"

class WebServer(private val assets: AssetManager) : NanoHTTPD(HTTP_PORT) {
    override fun serve(session: IHTTPSession): Response {
        var path = session.uri.trimStart('/')
        if (path.isEmpty()) path = "index.html"
        if (path.contains("..")) return newFixedLengthResponse(Response.Status.FORBIDDEN, MIME_PLAINTEXT, "Нельзя")
        return try {
            val input = assets.open("www/$path")
            newChunkedResponse(Response.Status.OK, mime(path), input).apply {
                addHeader("Cache-Control", "no-cache")
            }
        } catch (e: IOException) {
            newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Нет файла")
        }
    }

    private fun mime(p: String) = when (p.substringAfterLast('.').lowercase()) {
        "html" -> "text/html; charset=utf-8"
        "js" -> "application/javascript; charset=utf-8"
        "css" -> "text/css; charset=utf-8"
        "woff2" -> "font/woff2"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "json" -> "application/json"
        else -> "application/octet-stream"
    }
}

class Relay : WebSocketServer(InetSocketAddress(WS_PORT)) {
    private var host: WebSocket? = null
    private val players = HashMap<Int, WebSocket>()
    private val ids = HashMap<WebSocket, Int>()
    private var next = 1

    init {
        isReuseAddr = true
        connectionLostTimeout = 30
    }

    private fun safeSend(ws: WebSocket?, text: String) {
        try { if (ws != null && ws.isOpen) ws.send(text) } catch (e: Exception) { Log.w(TAG, "send: $e") }
    }

    private fun toHost(t: String, id: Int, m: String? = null) {
        val o = JSONObject().put("t", t).put("id", id)
        if (m != null) o.put("m", m)
        safeSend(host, o.toString())
    }

    @Synchronized
    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
        if (handshake.resourceDescriptor.contains("role=host")) {
            val old = host
            host = conn
            if (old != null && old != conn) old.close()
            players.keys.forEach { toHost("open", it) }
            players.values.forEach { safeSend(it, "{\"t\":\"rehello\"}") }
            return
        }
        val id = next++
        players[id] = conn
        ids[conn] = id
        toHost("open", id)
    }

    @Synchronized
    override fun onMessage(conn: WebSocket, message: String) {
        if (conn == host) {
            try {
                val env = JSONObject(message)
                val m = env.getString("m")
                when (val to = env.opt("to")) {
                    "all" -> players.values.forEach { safeSend(it, m) }
                    is JSONArray -> for (i in 0 until to.length()) safeSend(players[to.optInt(i)], m)
                }
            } catch (e: Exception) { Log.w(TAG, "host message: $e") }
            return
        }
        val id = ids[conn] ?: return
        toHost("from", id, message)
    }

    @Synchronized
    override fun onClose(conn: WebSocket, code: Int, reason: String?, remote: Boolean) {
        if (conn == host) { host = null; return }
        val id = ids.remove(conn) ?: return
        players.remove(id)
        toHost("close", id)
    }

    override fun onError(conn: WebSocket?, ex: Exception) { Log.w(TAG, "relay: $ex") }
    override fun onStart() { Log.i(TAG, "relay on $WS_PORT") }
}

object Servers {
    private var web: WebServer? = null
    private var relay: Relay? = null

    @Synchronized
    fun start(assets: AssetManager) {
        if (web == null) {
            try { web = WebServer(assets).also { it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, true) } }
            catch (e: IOException) { Log.e(TAG, "http: $e") }
        }
        if (relay == null) {
            relay = Relay().also { it.start() }
        }
    }

    @Synchronized
    fun stop() {
        try { relay?.stop(500) } catch (e: Exception) { /* уже остановлен */ }
        web?.stop()
        relay = null; web = null
    }

    // Адреса этого телефона, по которым к нему подключатся игроки. Точка доступа — первой.
    fun addresses(): List<String> {
        val found = mutableListOf<Pair<Int, String>>()
        val skip = listOf("rmnet", "ccmni", "dummy", "tun", "ppp", "p2p", "v4-", "clat", "ims", "radio", "lo")
        try {
            for (ni in Collections.list(NetworkInterface.getNetworkInterfaces() ?: return emptyList())) {
                if (!ni.isUp || ni.isLoopback) continue
                val name = ni.name.lowercase()
                if (skip.any { name.startsWith(it) }) continue
                for (a in Collections.list(ni.inetAddresses)) {
                    if (a !is Inet4Address || a.isLoopbackAddress || !a.isSiteLocalAddress) continue
                    val ip = a.hostAddress ?: continue
                    val score = when {
                        name.startsWith("ap") || name.startsWith("swlan") || name.startsWith("softap") -> 0
                        name.startsWith("wlan") && ip.endsWith(".1") -> 1
                        name.startsWith("wlan") -> 2
                        else -> 3
                    }
                    found.add(score to ip)
                }
            }
        } catch (e: Exception) { Log.w(TAG, "addresses: $e") }
        return found.sortedBy { it.first }.map { it.second }.distinct()
    }
}
