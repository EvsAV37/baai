// «Баай» — экран хоста: игра в WebView, загруженная со своего же сервера.
// © 2026 Евсеев А.В.
package ru.evseev.baai

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray

class MainActivity : Activity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Servers.start(assets)

        web = WebView(this)
        setContentView(web)
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_NO_CACHE
            textZoom = 100
        }
        web.addJavascriptInterface(Bridge(), "BaaiAndroid")
        web.webViewClient = object : WebViewClient() {
            // ссылки наружу не открываем: игра работает без интернета
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) =
                !request.url.toString().startsWith("http://127.0.0.1:$HTTP_PORT")
        }
        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl("http://127.0.0.1:$HTTP_PORT/")
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        AlertDialog.Builder(this)
            .setTitle("Выйти из игры?")
            .setMessage("Партия сохранится. Пока приложение закрыто, игроки не смогут ходить.")
            .setPositiveButton("Выйти") { _, _ -> finish() }
            .setNegativeButton("Остаться", null)
            .show()
    }

    override fun onDestroy() {
        if (isFinishing) Servers.stop()
        web.destroy()
        super.onDestroy()
    }

    inner class Bridge {
        @JavascriptInterface
        fun ips(): String = JSONArray(Servers.addresses()).toString()

        @JavascriptInterface
        fun keepAwake(on: Boolean) {
            runOnUiThread {
                if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }
}
