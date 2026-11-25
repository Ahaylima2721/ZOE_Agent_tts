package com.zoefoco.app

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** Um horário de foco recorrente. dias: 0 = domingo ... 6 = sábado. início e fim em minutos do dia. */
data class Bloco(val dias: Set<Int>, val inicio: Int, val fim: Int)

/**
 * Tudo que a Zoe guarda, só no celular (SharedPreferences).
 * Nada daqui sai do aparelho: o app nem tem permissão de internet.
 */
object Store {
    private const val MIN = 60_000L

    fun p(c: Context): SharedPreferences = c.getSharedPreferences("zoe", Context.MODE_PRIVATE)

    fun dia(t: Long = System.currentTimeMillis()): String =
        SimpleDateFormat("yyyyMMdd", Locale.US).format(Date(t))

    // ---------------- configuração ----------------

    fun onboarded(c: Context) = p(c).getBoolean("onboarded", false)
    fun setOnboarded(c: Context) = p(c).edit().putBoolean("onboarded", true).apply()

    fun vigiados(c: Context): Set<String> = p(c).getStringSet("vigiados", emptySet())!!.toSet()
    fun setVigiados(c: Context, s: Set<String>) = p(c).edit().putStringSet("vigiados", s).apply()

    fun tom(c: Context): String = p(c).getString("tom", "firme")!!
    fun setTom(c: Context, t: String) {
        if (t in setOf("gentil", "firme", "brava")) p(c).edit().putString("tom", t).apply()
    }

    fun voz(c: Context) = p(c).getBoolean("voz", true)
    fun setVoz(c: Context, v: Boolean) = p(c).edit().putBoolean("voz", v).apply()

    fun blocosJson(c: Context): String = p(c).getString("blocos", "[]")!!
    fun setBlocos(c: Context, json: String) {
        parseBlocos(json) // valida antes de salvar
        p(c).edit().putString("blocos", json).apply()
    }

    fun blocos(c: Context): List<Bloco> = try {
        parseBlocos(blocosJson(c))
    } catch (e: Exception) {
        emptyList()
    }

    private fun parseBlocos(json: String): List<Bloco> {
        val arr = JSONArray(json)
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            val d = o.getJSONArray("dias")
            val dias = (0 until d.length()).map { d.getInt(it) }.filter { it in 0..6 }.toSet()
            val ini = o.getInt("inicio").coerceIn(0, 24 * 60)
            val fim = o.getInt("fim").coerceIn(0, 24 * 60)
            require(fim > ini) { "o fim precisa ser depois do início" }
            Bloco(dias, ini, fim)
        }
    }

    // ---------------- hábitos e energia ----------------

    fun habitosJson(c: Context): String = p(c).getString("habitos", "[]")!!
    fun setHabitos(c: Context, json: String) {
        JSONArray(json) // valida
        p(c).edit().putString("habitos", json).apply()
    }

    private fun pontosDoHabito(c: Context, id: String): Int {
        val arr = JSONArray(habitosJson(c))
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            if (o.optString("id") == id) return o.optInt("pontos", 10)
        }
        return 10
    }

    fun feitosHoje(c: Context): Set<String> = feitos(c, dia())
    private fun feitos(c: Context, d: String): Set<String> = p(c).getStringSet("feitos_$d", emptySet())!!.toSet()

    fun alternarHabito(c: Context, id: String) {
        val k = "feitos_${dia()}"
        val s = feitosHoje(c).toMutableSet()
        val pts = pontosDoHabito(c, id)
        if (s.remove(id)) addEnergia(c, -pts) else {
            s.add(id); addEnergia(c, pts)
        }
        p(c).edit().putStringSet(k, s).apply()
    }

    /** Dias seguidos com pelo menos metade dos hábitos feitos. Hoje só conta se já bateu a meta. */
    fun sequencia(c: Context): Int {
        val n = JSONArray(habitosJson(c)).length()
        if (n == 0) return 0
        val meta = (n + 1) / 2
        val cal = Calendar.getInstance()
        var seq = 0
        for (i in 0..365) {
            val ok = feitos(c, dia(cal.timeInMillis)).size >= meta
            if (ok) seq++ else if (i > 0) break
            cal.add(Calendar.DAY_OF_YEAR, -1)
        }
        return seq
    }

    fun energia(c: Context): Int {
        decairSeNovoDia(c)
        return p(c).getInt("energia", 60)
    }

    fun addEnergia(c: Context, d: Int) {
        decairSeNovoDia(c)
        val e = (p(c).getInt("energia", 60) + d).coerceIn(0, 100)
        p(c).edit().putInt("energia", e).apply()
    }

    /** Todo dia novo a Zoe acorda um pouco mais cansada, mas nunca abaixo de 20: ela nunca morre. */
    private fun decairSeNovoDia(c: Context) {
        val hoje = dia()
        val ultimo = p(c).getString("ultimoDia", null)
        if (ultimo == hoje) return
        val e = p(c).getInt("energia", 60)
        val novo = if (ultimo == null) e else (e - 10).coerceAtLeast(20)
        p(c).edit().putString("ultimoDia", hoje).putInt("energia", novo).apply()
    }

    // ---------------- foco ----------------

    fun focoManualAte(c: Context) = p(c).getLong("focoManualAte", 0)
    private fun pularAte(c: Context) = p(c).getLong("pularAte", 0)

    private fun meiaNoite(t: Long, offsetDias: Int = 0): Calendar = Calendar.getInstance().apply {
        timeInMillis = t
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        add(Calendar.DAY_OF_YEAR, offsetDias)
    }

    private fun diaDaSemana(cal: Calendar) = cal.get(Calendar.DAY_OF_WEEK) - 1

    /** Fim do bloco agendado que cobre "agora", se houver. */
    private fun fimDoBlocoAtual(c: Context, agora: Long): Long? {
        val m = meiaNoite(agora)
        val dow = diaDaSemana(m)
        val minutos = ((agora - m.timeInMillis) / MIN).toInt()
        return blocos(c)
            .filter { dow in it.dias && minutos >= it.inicio && minutos < it.fim }
            .maxOfOrNull { m.timeInMillis + it.fim * MIN }
    }

    /** Quando o foco atual acaba, ou null se não tem foco agora. */
    fun fimDoFoco(c: Context, agora: Long = System.currentTimeMillis()): Long? {
        val manual = focoManualAte(c).takeIf { it > agora }
        val bloco = fimDoBlocoAtual(c, agora)?.takeIf { agora >= pularAte(c) }
        return listOfNotNull(manual, bloco).maxOrNull()
    }

    fun focoAtivo(c: Context) = fimDoFoco(c) != null

    private fun limites(c: Context, agora: Long): List<Pair<Long, Boolean>> {
        val out = mutableListOf<Pair<Long, Boolean>>() // (horário, éInício)
        for (off in 0..7) {
            val m = meiaNoite(agora, off)
            val dow = diaDaSemana(m)
            for (b in blocos(c)) if (dow in b.dias) {
                out += m.timeInMillis + b.inicio * MIN to true
                out += m.timeInMillis + b.fim * MIN to false
            }
        }
        return out
    }

    /** Próximo momento em que o estado do foco pode mudar (para agendar o alarme). */
    fun proximoLimite(c: Context, agora: Long = System.currentTimeMillis()): Long? {
        val t = limites(c, agora).map { it.first }.toMutableList()
        t += focoManualAte(c)
        return t.filter { it > agora + 500 }.minOrNull()
    }

    /** Próximo início de foco agendado (para mostrar na tela). */
    fun proximoInicio(c: Context, agora: Long = System.currentTimeMillis()): Long? =
        limites(c, agora).filter { it.second && it.first > agora }.minOfOrNull { it.first }

    fun iniciarFocoManual(c: Context, minutos: Int) {
        val ate = System.currentTimeMillis() + minutos.coerceIn(5, 240) * MIN
        p(c).edit().putLong("focoManualAte", ate).putBoolean("encerradoNaMao", false).apply()
    }

    /** Encerrar antes da hora: vale para o foco manual e para o bloco agendado de agora. */
    fun encerrarFoco(c: Context) {
        val agora = System.currentTimeMillis()
        val fimBloco = fimDoBlocoAtual(c, agora) ?: 0L
        p(c).edit()
            .putLong("focoManualAte", 0)
            .putLong("pularAte", fimBloco)
            .putBoolean("encerradoNaMao", true)
            .apply()
        addEnergia(c, -10)
    }

    fun encerradoNaMao(c: Context) = p(c).getBoolean("encerradoNaMao", false)

    // ---------------- sessão de foco e petelecos ----------------

    fun novaSessao(c: Context) =
        p(c).edit().putInt("tentativas", 0).putBoolean("encerradoNaMao", false)
            .putLong("inicioSessao", System.currentTimeMillis()).apply()

    fun tentativas(c: Context) = p(c).getInt("tentativas", 0)

    fun registrarTentativa(c: Context): Int {
        val n = tentativas(c) + 1
        p(c).edit().putInt("tentativas", n)
            .putInt("petelecos_${dia()}", petelecosHoje(c) + 1).apply()
        if (n >= 2) addEnergia(c, -5)
        return n
    }

    fun petelecosHoje(c: Context) = p(c).getInt("petelecos_${dia()}", 0)

    fun emergenciaAte(c: Context) = p(c).getLong("emergenciaAte", 0)

    fun usarEmergencia(c: Context) {
        p(c).edit().putLong("emergenciaAte", System.currentTimeMillis() + 5 * MIN).apply()
        addEnergia(c, -15)
    }

    fun focoConcluido(c: Context) {
        val ini = p(c).getLong("inicioSessao", System.currentTimeMillis())
        val min = ((System.currentTimeMillis() - ini) / MIN).toInt()
        p(c).edit().putInt("minutosFoco_${dia()}", minutosFocoHoje(c) + min).apply()
        addEnergia(c, 10)
    }

    fun minutosFocoHoje(c: Context) = p(c).getInt("minutosFoco_${dia()}", 0)
}
