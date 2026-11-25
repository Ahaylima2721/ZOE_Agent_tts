package com.zoefoco.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.util.Calendar

/**
 * Dois avisos por dia, ambos opcionais:
 *  - lembrete dos hábitos (padrão 20h), só se ainda faltar algum;
 *  - resumo do dia às 22h.
 * Usa alarmes "aproximados" (janela de 10 min): não precisam de permissão e gastam menos bateria.
 */
object Lembretes {
    const val LEMBRETE = "com.zoefoco.app.LEMBRETE"
    const val RESUMO = "com.zoefoco.app.RESUMO"

    fun agendar(c: Context) {
        agendarUm(c, LEMBRETE, Store.lembreteHora(c), 2, Store.lembreteAtivo(c))
        agendarUm(c, RESUMO, 22 * 60, 3, Store.resumoAtivo(c))
    }

    private fun agendarUm(c: Context, acao: String, minuto: Int, req: Int, ativo: Boolean) {
        val am = c.getSystemService(AlarmManager::class.java)
        val pi = PendingIntent.getBroadcast(
            c, req, Intent(c, LembreteReceiver::class.java).setAction(acao),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        am.cancel(pi)
        if (!ativo) return
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, minuto / 60); set(Calendar.MINUTE, minuto % 60)
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            if (timeInMillis <= System.currentTimeMillis() + 30_000) add(Calendar.DAY_OF_YEAR, 1)
        }
        am.setWindow(AlarmManager.RTC_WAKEUP, cal.timeInMillis, 10 * 60_000L, pi)
    }
}

class LembreteReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        when (i.action) {
            Lembretes.LEMBRETE -> {
                val faltam = Store.habitosPendentes(c)
                if (faltam.isNotEmpty()) {
                    val titulo = if (faltam.size == 1) "Falta só 1 hábito hoje" else "Faltam ${faltam.size} hábitos hoje"
                    Avisos.notificar(c, 3, titulo, faltam.joinToString(" · ") + ". Bora? Eu fico feliz!", "hoje")
                }
            }
            Lembretes.RESUMO -> {
                val total = Store.habitosPendentes(c).size + Store.feitosHoje(c).size
                val texto = "${Store.feitosHoje(c).size} de $total hábitos · ${Store.minutosFocoHoje(c)} min de foco · " +
                    "${Store.petelecosHoje(c)} ${if (Store.petelecosHoje(c) == 1) "peteleco" else "petelecos"}"
                Avisos.notificar(c, 4, "Seu dia com a Zoe", texto, "resumo")
            }
            else -> return
        }
        Lembretes.agendar(c)
    }
}
