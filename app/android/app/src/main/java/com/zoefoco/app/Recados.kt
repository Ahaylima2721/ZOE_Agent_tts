package com.zoefoco.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.PowerManager
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * O "cérebro" da bolinha. Fora do foco, a cada ~5 min (só com a tela ligada):
 *  1. aviso de rolagem: muito tempo seguido nos apps vigiados, ou passou do limite do dia;
 *  2. recados: hábito pendente, revisão, livro parado, trilha parada, comemoração.
 * Nunca no foco, nunca das 22h às 8h, nunca em ligação. Tudo offline.
 */
object Recados {
    private const val MIN = 60_000L
    private const val TIQUE = 5 * MIN
    private const val ENTRE_RECADOS = 2 * 60 * MIN

    // ---------------- agenda ----------------

    fun agendar(c: Context, daquiA: Long = TIQUE) {
        val am = c.getSystemService(AlarmManager::class.java)
        val pi = PendingIntent.getBroadcast(
            c, 6, Intent(c, RecadoReceiver::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        am.cancel(pi)
        if (!Store.onboarded(c) || (!Store.recadosAtivos(c) && !Store.rolagemAtiva(c))) return
        var t = System.currentTimeMillis() + daquiA
        if (Store.silencio(t)) {
            t = Calendar.getInstance().apply {
                if (get(Calendar.HOUR_OF_DAY) >= 22) add(Calendar.DAY_OF_YEAR, 1)
                set(Calendar.HOUR_OF_DAY, 8); set(Calendar.MINUTE, 5); set(Calendar.SECOND, 0)
            }.timeInMillis
        }
        // RTC (sem WAKEUP): com a tela desligada o celular não acorda por causa da Zoe.
        if (Perms.alarmes(c)) am.setExact(AlarmManager.RTC, t, pi)
        else am.setWindow(AlarmManager.RTC, t, 2 * MIN, pi)
    }

    // ---------------- o tique ----------------

    fun tique(c: Context) {
        try {
            avaliar(c)
        } finally {
            val adiado = Store.adiadoAte(c) - System.currentTimeMillis()
            agendar(c, if (adiado in 1 until TIQUE) adiado + 5_000 else TIQUE)
        }
    }

    private fun avaliar(c: Context) {
        if (!Store.onboarded(c) || Bolha.visivel) return
        if (Store.focoAtivo(c) || Store.silencio()) return
        if (!Perms.sobrepor(c)) return
        if (!c.getSystemService(PowerManager::class.java).isInteractive) return
        val audio = c.getSystemService(AudioManager::class.java)
        if (audio.mode == AudioManager.MODE_IN_CALL || audio.mode == AudioManager.MODE_IN_COMMUNICATION) return

        avisoDeRolagem(c)?.let { Bolha.mostrar(c, it); return }

        if (!Store.recadosAtivos(c)) return
        if (Store.recadosHoje(c) >= Store.limiteRecadosHoje(c)) return
        if (System.currentTimeMillis() - Store.ultimoRecado(c) < ENTRE_RECADOS) return
        escolherRecado(c)?.let {
            Store.registrarRecado(c, it.getString("chave"))
            Bolha.mostrar(c, it)
        }
    }

    // ---------------- aviso de rolagem ----------------

    private class Sessao(val pkg: String, val ini: Long, var fim: Long)

    /** Sessões de apps em primeira tela nas últimas 3h (a última pode estar aberta: fim = agora). */
    private fun sessoes(c: Context, agora: Long): List<Sessao> {
        val usm = c.getSystemService(UsageStatsManager::class.java)
        val ev = usm.queryEvents(agora - 3 * 60 * MIN, agora)
        val e = UsageEvents.Event()
        val out = mutableListOf<Sessao>()
        var atual: Sessao? = null
        while (ev.hasNextEvent()) {
            ev.getNextEvent(e)
            @Suppress("DEPRECATION")
            when (e.eventType) {
                UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                    atual?.let { if (it.fim == Long.MAX_VALUE) it.fim = e.timeStamp }
                    atual = Sessao(e.packageName, e.timeStamp, Long.MAX_VALUE).also { out += it }
                }
                UsageEvents.Event.MOVE_TO_BACKGROUND ->
                    if (atual?.pkg == e.packageName && atual.fim == Long.MAX_VALUE) atual.fim = e.timeStamp
            }
        }
        return out
    }

    /** Minutos seguidos nos apps vigiados até agora (troca rápida entre eles conta junto). Null se não está num vigiado. */
    private fun minutosSeguidos(c: Context, vig: Set<String>, agora: Long): Pair<Int, List<String>>? {
        val ss = sessoes(c, agora)
        val ultima = ss.lastOrNull() ?: return null
        if (ultima.fim != Long.MAX_VALUE || ultima.pkg !in vig) return null
        var inicio = ultima.ini
        val apps = linkedSetOf(ultima.pkg)
        for (i in ss.size - 2 downTo 0) {
            val s = ss[i]
            if (s.pkg !in vig || inicio - s.fim > 90_000) break
            inicio = s.ini
            apps += s.pkg
        }
        return ((agora - inicio) / MIN).toInt() to apps.toList()
    }

    private fun minutosHoje(c: Context, vig: Set<String>): Map<String, Int> {
        val usm = c.getSystemService(UsageStatsManager::class.java)
        val agora = System.currentTimeMillis()
        val m = usm.queryAndAggregateUsageStats(Store.inicioDoDia(agora), agora)
        return vig.associateWith { ((m[it]?.totalTimeInForeground ?: 0L) / MIN).toInt() }
    }

    private fun mediaSemana(c: Context, vig: Set<String>): Int {
        val p = Store.p(c)
        if (p.getString("mediaDia", "") == Store.dia()) return p.getInt("media", 0)
        val usm = c.getSystemService(UsageStatsManager::class.java)
        val ini = Store.inicioDoDia()
        val m = usm.queryAndAggregateUsageStats(ini - 7L * 24 * 3600_000, ini)
        val media = (vig.sumOf { m[it]?.totalTimeInForeground ?: 0L } / MIN / 7).toInt()
        p.edit().putInt("media", media).putString("mediaDia", Store.dia()).apply()
        return media
    }

    private fun avisoDeRolagem(c: Context): JSONObject? {
        if (!Store.rolagemAtiva(c) || !Perms.uso(c)) return null
        if (Store.rolagemSilenciadaHoje(c) || Store.avisosRolagemHoje(c) >= 2) return null
        val vig = Store.vigiados(c)
        if (vig.isEmpty()) return null
        val agora = System.currentTimeMillis()
        val adiado = Store.adiadoAte(c)
        if (agora < adiado) return null
        val (seguidos, apps) = minutosSeguidos(c, vig, agora) ?: return null
        val hoje = minutosHoje(c, vig)
        val total = hoje.values.sum()
        val nomeAtual = nome(c, apps.first())

        // 2º aviso: passou o "só mais 10 min" e continua rolando
        if (adiado > 0 && agora - adiado < 20 * MIN) {
            Store.p(c).edit().putLong("rolagemAdiadoAte", 0).apply()
            Store.contarAvisoRolagem(c)
            val media = mediaSemana(c, vig)
            val usados = hoje.filter { it.value > 0 }.keys.map { nome(c, it) }
            val comp = if (media > 0 && total > media) {
                val x = total.toDouble() / media
                if (x >= 1.8) ", quase o dobro da sua média" else ", acima da sua média de ${tempo(media)}"
            } else ""
            return recado("rolagem2", "tela", "triste",
                titulo = "Os 10 minutos já passaram",
                texto = "Hoje foram ${tempo(total)}${if (usados.size > 1) " entre " + juntar(usados) else " de $nomeAtual"}$comp. Quer uma ajudinha minha?",
                botoes = listOf(
                    botao("foco25", "Começar um foco de 25 min", "Eu fico de guarda e os petelecos voltam", true),
                    botao("pausa30", "Pausar as redes por 30 min", "Só se você quiser: igual ao bloqueio do foco"),
                    botao("deixa", "Me deixa, Zoe", "Hoje eu não falo mais disso")
                ))
        }
        Store.p(c).edit().putLong("rolagemAdiadoAte", 0).apply()

        val ultimoAviso = Store.p(c).getLong("ultimoAvisoRolagem", 0)
        if (agora - ultimoAviso < 30 * MIN) return null
        val passouSeguidos = seguidos >= Store.rolagemSeguidos(c)
        val passouLimite = total >= Store.rolagemLimite(c) && !Store.p(c).getBoolean("avisouLimite_${Store.dia()}", false)
        if (!passouSeguidos && !passouLimite) return null

        Store.contarAvisoRolagem(c)
        Store.p(c).edit().putLong("ultimoAvisoRolagem", agora)
            .putBoolean("avisouLimite_${Store.dia()}", passouLimite || Store.p(c).getBoolean("avisouLimite_${Store.dia()}", false)).apply()
        val doApp = hoje[apps.first()] ?: 0
        val titulo = if (passouSeguidos) "Ei, já são ${tempo(maxOf(doApp, seguidos))} de $nomeAtual hoje"
        else "Hoje já foram ${tempo(total)} nas redes"
        val texto = (if (passouSeguidos) "Os últimos $seguidos min sem parar. " else "Passou do seu limite de ${tempo(Store.rolagemLimite(c))}. ") +
            "Não é hora de foco, então a escolha é sua. Tá tudo bem?"
        val botoes = mutableListOf(botao("sair", "Valeu, vou sair", forte = true), botao("mais10", "Só mais 10 min"))
        if (Store.temPerguntas(c)) botoes += botao("pergunta", "Uma pergunta no lugar")
        botoes += botao("deboa", "Tô de boa hoje")
        return recado("rolagem1", "topo", "", titulo = titulo, texto = texto, botoes = botoes)
    }

    // ---------------- recados ----------------

    private fun escolherRecado(c: Context): JSONObject? {
        val h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)

        // 1. hábito pendente perto do fim do dia
        if (h >= 18 && !Store.recadoJaDado(c, "habito")) {
            val arr = JSONArray(Store.habitosJson(c))
            val feitos = Store.feitosHoje(c)
            val pend = (0 until arr.length()).map { arr.getJSONObject(it) }.firstOrNull { it.optString("id") !in feitos }
            if (pend != null) {
                val nomeH = pend.optString("nome")
                return recado("habito", "bolha", "", balao = "Ainda dá tempo: ${nomeH.lowercase()}",
                    texto = "Ainda dá tempo de cuidar desse hábito hoje: $nomeH. Bora?",
                    contexto = "Hábitos de hoje",
                    botoes = listOf(botao("habito:${pend.optString("id")}", "Feito!", forte = true), botao("depois", "Agora não")))
            }
        }

        val trilhas = jsonArray(Store.ler(c, "est_trilhas"))
        val perguntas = jsonArray(Store.ler(c, "est_perguntas"))
        val hoje = Store.dia()

        // 2. perguntas para revisar
        if (!Store.recadoJaDado(c, "revisao")) {
            val n = (0 until perguntas.length()).count { perguntas.getJSONObject(it).optString("proxima", "99999999") <= hoje }
            if (n > 0) {
                return recado("revisao", "bolha", "", balao = "Tenho $n ${if (n == 1) "pergunta" else "perguntas"} pra você",
                    texto = "Separei $n ${if (n == 1) "pergunta" else "perguntas"} pra revisar. Leva uns ${maxOf(1, n / 2)} min. Bora?",
                    contexto = "Estudos",
                    botoes = listOf(botao("pilula", "Bora!", forte = true), botao("depois", "Depois")))
            }
        }

        // 3. livro parado no mesmo capítulo há 5 dias
        if (!Store.recadoJaDado(c, "livro")) {
            for (i in 0 until trilhas.length()) {
                val t = trilhas.getJSONObject(i)
                if (t.optString("tipo") != "leitura" || t.has("concluida") || t.optBoolean("pausada")) continue
                val dias = diasDesde(t.optString("capituloEm", t.optString("criada")))
                if (dias >= 5) {
                    val titulo = t.optString("titulo")
                    return recado("livro", "bolha", "", balao = "Terminou $titulo?",
                        texto = "Faz $dias dias que você está no capítulo ${t.optString("capitulo")}. Terminou o livro ou parou em algum lugar?",
                        contexto = "Leitura · $titulo",
                        botoes = listOf(
                            botao("livroFim:${t.optString("id")}", "Terminei!", forte = true),
                            botao("livroAvancei:${t.optString("id")}", "Avancei uns capítulos"),
                            botao("livroPausa:${t.optString("id")}", "Parei de ler"),
                            botao("depois", "Depois")))
                }
            }
        }

        // 4. trilha de estudo parada há 4 dias
        if (!Store.recadoJaDado(c, "trilha")) {
            for (i in 0 until trilhas.length()) {
                val t = trilhas.getJSONObject(i)
                if (t.optString("tipo") != "estudo" || t.optBoolean("pausada")) continue
                val id = t.optString("id")
                val ultima = (0 until perguntas.length()).map { perguntas.getJSONObject(it) }
                    .filter { it.optString("trilha") == id }.mapNotNull { it.optString("ultima").takeIf { u -> u.isNotBlank() } }
                    .maxOrNull() ?: t.optString("criada")
                val dias = diasDesde(ultima)
                if (dias >= 4) {
                    val tema = t.optString("tema")
                    return recado("trilha", "bolha", "", balao = "Saudade de estudar $tema",
                        texto = "Faz $dias dias que a gente não estuda $tema. Uma pílula rapidinha?",
                        contexto = "Estudos · $tema",
                        botoes = listOf(botao("pilula", "Bora!", forte = true), botao("depois", "Depois")))
                }
            }
        }

        // 5. comemoração da sequência
        val seq = Store.sequencia(c)
        if (!Store.recadoJaDado(c, "festa") && seq >= 3) {
            val marcos = listOf(7, 30, 100)
            val prox = marcos.firstOrNull { seq < it }
            if (seq in marcos || seq % 5 == 0 || (prox != null && prox - seq <= 2)) {
                val txt = when {
                    seq in marcos -> "$seq dias seguidos! Olha só o meu visual novo."
                    prox != null -> "$seq dias seguidos! Faltam ${prox - seq} pro meu visual novo."
                    else -> "$seq dias seguidos! Você é demais."
                }
                return recado("festa", "bolha", "feliz", balao = "$seq dias seguidos!", texto = txt,
                    contexto = "Sequência", botoes = listOf(botao("depois", "Eba!", forte = true)))
            }
        }
        return null
    }

    // ---------------- respostas ----------------

    /** Executa a resposta. Devolve {reacao, depois}: depois = "" | "home" | "pilula" | "pilulaTroca" | "estudos". */
    fun responder(c: Context, id: String): JSONObject {
        Store.recadoRespondido(c)
        val r = JSONObject().put("depois", "")
        val partes = id.split(":", limit = 2)
        val arg = partes.getOrNull(1) ?: ""
        when (partes[0]) {
            "depois", "deixa", "deboa" -> {
                if (partes[0] != "depois") Store.silenciarRolagemHoje(c)
                r.put("reacao", when (partes[0]) {
                    "deixa" -> "Tudo bem, a escolha é sua. Amanhã a gente conversa."
                    "deboa" -> "Tudo bem! Hoje eu não falo mais de rede social."
                    else -> "Combinado!"
                })
            }
            "habito" -> {
                if (arg !in Store.feitosHoje(c)) Store.alternarHabito(c, arg)
                r.put("reacao", "Isso! Fiquei mais forte.").put("humor", "feliz")
            }
            "pilula" -> r.put("reacao", "Abrindo suas perguntas…").put("depois", "pilula")
            "pergunta" -> r.put("reacao", "Boa troca! Abrindo uma pergunta pra você.").put("depois", "pilulaTroca").put("humor", "feliz")
            "sair" -> {
                Store.recompensa(c, 5)
                r.put("reacao", "Orgulho! +5 de energia pra mim.").put("depois", "home").put("humor", "feliz")
            }
            "mais10" -> {
                Store.adiarRolagem(c, 10)
                agendar(c, 10 * MIN + 5_000)
                r.put("reacao", "Combinado. Daqui a 10 min eu passo aqui de novo.")
            }
            "foco25", "pausa30" -> {
                Store.iniciarFocoManual(c, if (partes[0] == "foco25") 25 else 30)
                Guard.sincronizar(c)
                r.put("reacao", if (partes[0] == "foco25") "Bora! Estou de guarda." else "Redes pausadas por 30 min. A emergência continua lá, se precisar.")
                    .put("depois", "home").put("humor", "feliz")
            }
            "livroFim", "livroPausa" -> {
                editarTrilha(c, arg) { t ->
                    if (partes[0] == "livroFim") t.put("concluida", Store.dia()) else t.put("pausada", true)
                }
                r.put("reacao", if (partes[0] == "livroFim") "Parabéns! Quer me contar o que achou? Abre a conversa nos Estudos." else "Tudo bem, pausei essa trilha.")
                if (partes[0] == "livroFim") r.put("humor", "feliz")
            }
            "livroAvancei" -> r.put("reacao", "Boa! Me conta em que capítulo você está.").put("depois", "estudos")
            else -> r.put("reacao", "Combinado!")
        }
        return r
    }

    private fun editarTrilha(c: Context, id: String, f: (JSONObject) -> Unit) {
        val arr = jsonArray(Store.ler(c, "est_trilhas"))
        for (i in 0 until arr.length()) if (arr.getJSONObject(i).optString("id") == id) f(arr.getJSONObject(i))
        Store.guardar(c, "est_trilhas", arr.toString())
    }

    // ---------------- utilidades ----------------

    private fun recado(chave: String, modo: String, humor: String, titulo: String = "", texto: String,
                       balao: String = "", contexto: String = "", botoes: List<JSONObject>) = JSONObject()
        .put("chave", chave).put("modo", modo).put("humor", humor).put("titulo", titulo)
        .put("texto", texto).put("balao", balao).put("contexto", contexto).put("botoes", JSONArray(botoes))

    private fun botao(id: String, texto: String, detalhe: String = "", forte: Boolean = false) =
        JSONObject().put("id", id).put("texto", texto).put("detalhe", detalhe).put("forte", forte)

    private fun nome(c: Context, pkg: String): String = try {
        c.packageManager.getApplicationLabel(c.packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (e: PackageManager.NameNotFoundException) {
        "esse app"
    }

    private fun juntar(l: List<String>) = if (l.size <= 1) l.joinToString() else l.dropLast(1).joinToString(", ") + " e " + l.last()

    fun tempo(min: Int) = if (min < 60) "$min min" else "${min / 60}h" + (if (min % 60 > 0) " ${"%02d".format(min % 60)}min" else "")

    private fun jsonArray(s: String) = try {
        JSONArray(s.ifBlank { "[]" })
    } catch (e: Exception) {
        JSONArray()
    }

    private fun diasDesde(yyyymmdd: String): Int = try {
        val d = SimpleDateFormat("yyyyMMdd", Locale.US).parse(yyyymmdd)!!.time
        ((Store.inicioDoDia() - Store.inicioDoDia(d)) / (24 * 3600_000L)).toInt()
    } catch (e: Exception) {
        0
    }
}

class RecadoReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) = Recados.tique(c)
}
