package com.zoefoco.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Liga e desliga o vigia nos horários de foco.
 * Fora do foco nada roda: só fica um alarme agendado para o próximo início ou fim.
 */
object Guard {

    fun sincronizar(c: Context) {
        if (Store.focoAtivo(c)) iniciar(c)
        agendarProximo(c)
    }

    fun iniciar(c: Context) {
        try {
            c.startForegroundService(Intent(c, FocusGuardService::class.java))
        } catch (e: Exception) {
            // Android 12+ pode recusar iniciar em segundo plano (sem alarme exato).
            // Aí a Zoe pede um toque pela notificação.
            Avisos.focoPrecisaDeToque(c)
        }
    }

    fun agendarProximo(c: Context) {
        val am = c.getSystemService(AlarmManager::class.java)
        val pi = PendingIntent.getBroadcast(
            c, 1, Intent(c, AlarmReceiver::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        am.cancel(pi)
        val t = Store.proximoLimite(c) ?: return
        if (Perms.alarmes(c)) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi)
        } else {
            am.setWindow(AlarmManager.RTC_WAKEUP, t, 60_000, pi)
        }
    }
}

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) = Guard.sincronizar(c)
}

class BootReceiver : BroadcastReceiver() {
    private val acoes = setOf(
        Intent.ACTION_BOOT_COMPLETED,
        Intent.ACTION_MY_PACKAGE_REPLACED,
        "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED"
    )

    override fun onReceive(c: Context, i: Intent) {
        if (i.action in acoes) {
            Guard.sincronizar(c)
            Lembretes.agendar(c)
        }
    }
}

object Avisos {
    const val CANAL_GUARDA = "guarda"
    const val CANAL_AVISOS = "avisos"
    const val ID_GUARDA = 1
    private const val ID_TOQUE = 2

    fun criarCanais(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CANAL_GUARDA, "Zoe de guarda", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Aparece enquanto a Zoe vigia o seu foco"
                setShowBadge(false)
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CANAL_AVISOS, "Avisos da Zoe", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Início do foco, lembretes de hábitos, resumo do dia e pílulas de estudo"
            }
        )
    }

    /** Notificação simples que abre o app numa tela (rota) da interface. */
    fun notificar(c: Context, id: Int, titulo: String, texto: String, rota: String) {
        criarCanais(c)
        val i = Intent(c, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(MainActivity.EXTRA_ROTA, rota)
        val pi = PendingIntent.getActivity(c, 100 + id, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(c, CANAL_AVISOS)
            .setSmallIcon(R.drawable.ic_zoe)
            .setContentTitle(titulo)
            .setContentText(texto)
            .setStyle(Notification.BigTextStyle().bigText(texto))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        try {
            c.getSystemService(NotificationManager::class.java).notify(id, n)
        } catch (e: SecurityException) {
            // sem permissão de notificação
        }
    }

    private fun abrirApp(c: Context, extra: String? = null): PendingIntent {
        val i = Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (extra != null) i.putExtra(extra, true)
        return PendingIntent.getActivity(c, extra.hashCode(), i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    fun guarda(c: Context, fim: Long): Notification {
        criarCanais(c)
        val hora = SimpleDateFormat("HH:mm", Locale("pt", "BR")).format(Date(fim))
        return Notification.Builder(c, CANAL_GUARDA)
            .setSmallIcon(R.drawable.ic_zoe)
            .setContentTitle("Zoe de guarda até $hora")
            .setContentText("Ela fecha os apps que você marcou. Bom foco!")
            .setOngoing(true)
            .setContentIntent(abrirApp(c))
            .build()
    }

    fun focoPrecisaDeToque(c: Context) {
        criarCanais(c)
        val n = Notification.Builder(c, CANAL_AVISOS)
            .setSmallIcon(R.drawable.ic_zoe)
            .setContentTitle("Hora do foco!")
            .setContentText("Toque para a Zoe ficar de guarda.")
            .setAutoCancel(true)
            .setContentIntent(abrirApp(c, MainActivity.EXTRA_INICIAR_GUARDA))
            .build()
        try {
            c.getSystemService(NotificationManager::class.java).notify(ID_TOQUE, n)
        } catch (e: SecurityException) {
            // sem permissão de notificação: não há como avisar
        }
    }
}
