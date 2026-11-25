package com.zoefoco.app

import android.app.NotificationManager
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper

/**
 * O vigia. Só roda durante o foco: a cada segundo pergunta ao sistema qual foi
 * o último app aberto. Se for um dos vilões, chama a Zoe por cima dele.
 */
class FocusGuardService : Service() {

    private val handler = Handler(Looper.getMainLooper())
    private var rodando = false
    private var ultimaConsulta = 0L
    private var appAtual: String? = null
    private var ultimoPeteleco = 0L
    private var fimMostrado = 0L

    private val tique = object : Runnable {
        override fun run() {
            verificar()
            if (rodando) handler.postDelayed(this, 1000)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val fim = Store.fimDoFoco(this)
        if (fim == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        entrarEmPrimeiroPlano(fim)
        if (!rodando) {
            rodando = true
            Store.novaSessao(this)
            // olha os últimos 10 min para saber qual app já está aberto quando o foco começa
            ultimaConsulta = System.currentTimeMillis() - 10 * 60_000
            handler.post(tique)
        }
        return START_STICKY
    }

    private fun entrarEmPrimeiroPlano(fim: Long) {
        fimMostrado = fim
        val n = Avisos.guarda(this, fim)
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(Avisos.ID_GUARDA, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(Avisos.ID_GUARDA, n)
        }
    }

    private fun verificar() {
        val agora = System.currentTimeMillis()
        val fim = Store.fimDoFoco(this, agora)
        if (fim == null) {
            terminar()
            return
        }
        if (fim != fimMostrado) {
            fimMostrado = fim
            getSystemService(NotificationManager::class.java).notify(Avisos.ID_GUARDA, Avisos.guarda(this, fim))
        }
        if (!Perms.uso(this)) return

        val usm = getSystemService(UsageStatsManager::class.java)
        val eventos = usm.queryEvents(ultimaConsulta - 1000, agora)
        ultimaConsulta = agora
        val ev = UsageEvents.Event()
        while (eventos.hasNextEvent()) {
            eventos.getNextEvent(ev)
            @Suppress("DEPRECATION")
            if (ev.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) appAtual = ev.packageName
        }

        val pkg = appAtual ?: return
        if (pkg == packageName) return
        if (pkg !in Store.vigiados(this)) return
        if (agora < Store.emergenciaAte(this)) return
        if (agora - ultimoPeteleco < 3000) return

        ultimoPeteleco = agora
        val tentativa = Store.registrarTentativa(this)
        val intent = Intent(this, PetelecoActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
            .putExtra(PetelecoActivity.EXTRA_NIVEL, tentativa.coerceAtMost(3))
            .putExtra(PetelecoActivity.EXTRA_PACOTE, pkg)
            .putExtra(PetelecoActivity.EXTRA_FIM, fim)
        try {
            startActivity(intent)
        } catch (e: Exception) {
            // sem a permissão de sobrepor, o Android pode bloquear: tenta de novo no próximo segundo
            ultimoPeteleco = 0
        }
    }

    private fun terminar() {
        if (!rodando) return
        rodando = false
        handler.removeCallbacks(tique)
        if (!Store.encerradoNaMao(this)) Store.focoConcluido(this)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        Guard.agendarProximo(this)
    }

    override fun onDestroy() {
        rodando = false
        handler.removeCallbacks(tique)
        super.onDestroy()
    }
}
