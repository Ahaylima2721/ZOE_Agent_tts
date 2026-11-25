package com.zoefoco.app

import android.app.Activity
import android.app.usage.UsageStatsManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.window.OnBackInvokedDispatcher
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

class MainActivity : Activity() {

    companion object {
        const val EXTRA_INICIAR_GUARDA = "iniciarGuarda"

        /** Sugestões já marcadas na tela "Seus vilões". */
        val SUGERIDOS = setOf(
            "com.instagram.android", "com.instagram.lite",
            "com.facebook.katana", "com.facebook.lite",
            "com.google.android.youtube",
            "com.zhiliaoapp.musically", "com.ss.android.ugc.trill",
            "com.twitter.android", "com.kwai.video", "com.reddit.frontpage"
        )
    }

    private lateinit var web: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Avisos.criarCanais(this)
        web = Web.criar(this, Ponte(), Web.FUNDO)
        setContentView(Web.moldura(this, web, Web.FUNDO, iconesEscuros = true))
        web.loadUrl("file:///android_asset/www/index.html")
        tratarIntent(intent)

        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { voltar() }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        tratarIntent(intent)
    }

    private fun tratarIntent(i: Intent?) {
        if (i?.getBooleanExtra(EXTRA_INICIAR_GUARDA, false) == true) Guard.iniciar(this)
    }

    override fun onResume() {
        super.onResume()
        Guard.sincronizar(this)
        // voltou das configurações: a página atualiza o estado das permissões
        web.evaluateJavascript("window.zoeVoltou && zoeVoltou()", null)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        web.evaluateJavascript("window.zoeVoltou && zoeVoltou()", null)
    }

    private fun voltar() {
        web.evaluateJavascript("window.zoeVoltar ? zoeVoltar() : false") { r ->
            if (r != "true") finish()
        }
    }

    @Deprecated("Usado só até o Android 12")
    @Suppress("DEPRECATION")
    override fun onBackPressed() = voltar()

    /** O que a página HTML pode pedir para o Android. Tudo devolve JSON em texto. */
    inner class Ponte {
        private val c get() = this@MainActivity

        @JavascriptInterface
        fun estado(): String = JSONObject()
            .put("onboarded", Store.onboarded(c))
            .put("energia", Store.energia(c))
            .put("sequencia", Store.sequencia(c))
            .put("tom", Store.tom(c))
            .put("vigiados", JSONArray(Store.vigiados(c).toList()))
            .put("nomesVigiados", JSONArray(Store.vigiados(c).map { nomeDoApp(it) }))
            .put("blocos", JSONArray(Store.blocosJson(c)))
            .put("habitos", JSONArray(Store.habitosJson(c)))
            .put("feitosHoje", JSONArray(Store.feitosHoje(c).toList()))
            .put("foco", JSONObject()
                .put("ativo", Store.focoAtivo(c))
                .put("fim", Store.fimDoFoco(c) ?: 0L)
                .put("tentativas", Store.tentativas(c))
                .put("proximo", Store.proximoInicio(c) ?: 0L))
            .put("petelecosHoje", Store.petelecosHoje(c))
            .put("minutosFocoHoje", Store.minutosFocoHoje(c))
            .put("perms", Perms.estado(c))
            .put("agora", System.currentTimeMillis())
            .toString()

        /** Apps instalados (que abrem pela tela inicial), com ícone e tempo médio por dia. */
        @JavascriptInterface
        fun apps(): String {
            val pm = packageManager
            val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val lista = pm.queryIntentActivities(launcher, 0)
                .map { it.activityInfo.packageName }
                .distinct()
                .filter { it != packageName }
            val minutos = minutosPorDia()
            val vigiados = Store.vigiados(c)
            val out = JSONArray()
            lista.map { pkg -> pkg to (minutos[pkg] ?: 0) }
                .sortedWith(compareByDescending<Pair<String, Int>> { it.first in SUGERIDOS }.thenByDescending { it.second })
                .forEach { (pkg, min) ->
                    out.put(JSONObject()
                        .put("pacote", pkg)
                        .put("nome", nomeDoApp(pkg))
                        .put("minutos", min)
                        .put("sugerido", pkg in SUGERIDOS)
                        .put("vigiado", pkg in vigiados)
                        .put("icone", icone(pkg)))
                }
            return out.toString()
        }

        @JavascriptInterface
        fun salvarVigiados(json: String) {
            val arr = JSONArray(json)
            Store.setVigiados(c, (0 until arr.length()).map { arr.getString(it) }.toSet())
        }

        @JavascriptInterface
        fun salvarHabitos(json: String) = Store.setHabitos(c, json)

        @JavascriptInterface
        fun alternarHabito(id: String) = Store.alternarHabito(c, id)

        @JavascriptInterface
        fun salvarBlocos(json: String): Boolean = try {
            Store.setBlocos(c, json); Guard.sincronizar(c); true
        } catch (e: Exception) {
            false
        }

        @JavascriptInterface
        fun salvarTom(tom: String) = Store.setTom(c, tom)

        @JavascriptInterface
        fun concluirBoasVindas() {
            Store.setOnboarded(c)
            Guard.sincronizar(c)
        }

        @JavascriptInterface
        fun liberar(nome: String) = runOnUiThread { Perms.abrir(c, nome) }

        @JavascriptInterface
        fun focarAgora(minutos: Int) {
            Store.iniciarFocoManual(c, minutos)
            Guard.sincronizar(c)
        }

        @JavascriptInterface
        fun encerrarFoco() {
            Store.encerrarFoco(c)
            Guard.agendarProximo(c)
        }
    }

    private fun nomeDoApp(pkg: String): String = try {
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (e: PackageManager.NameNotFoundException) {
        pkg
    }

    private fun minutosPorDia(): Map<String, Int> {
        if (!Perms.uso(this)) return emptyMap()
        val usm = getSystemService(UsageStatsManager::class.java)
        val agora = System.currentTimeMillis()
        return usm.queryAndAggregateUsageStats(agora - 7L * 24 * 3600_000, agora)
            .mapValues { (it.value.totalTimeInForeground / 60_000 / 7).toInt() }
    }

    private fun icone(pkg: String): String = try {
        val d = packageManager.getApplicationIcon(pkg)
        val tam = 96
        val bmp = Bitmap.createBitmap(tam, tam, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        d.setBounds(0, 0, tam, tam)
        d.draw(canvas)
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    } catch (e: Exception) {
        ""
    }
}
