package com.zoefoco.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder

class IaErro(val codigo: Int, mensagem: String, val chaveRuim: Boolean = false) : Exception(mensagem)

/**
 * A inteligência da Zoe (só para Estudos), usando o Gemini do Google no plano gratuito.
 *
 * Pacote de perguntas, em dois passos:
 *  1. pesquisa: o Gemini busca na web (Google Search) e escreve notas com fontes.
 *     Se a busca não estiver liberada para a chave, usa Wikipedia e Open Library (grátis, sem chave).
 *  2. perguntas: o Gemini transforma as notas em perguntas em JSON, cada uma apontando a fonte.
 *
 * O que sai do celular: só o tema da trilha (e as mensagens da conversa). Nunca hábitos nem uso de apps.
 * A chave fica num arquivo separado ("segredo"), fora do backup do Android.
 */
object Ia {
    private const val BASE = "https://generativelanguage.googleapis.com/v1beta"
    private const val UA = "ZoeFoco/0.2.1 (app Android)"
    private const val PERGUNTAS_POR_PACOTE = 12

    private fun segredo(c: Context) = c.getSharedPreferences("segredo", Context.MODE_PRIVATE)

    fun chave(c: Context): String? = segredo(c).getString("gemini", null)?.takeIf { it.isNotBlank() }
    fun salvarChave(c: Context, k: String) = segredo(c).edit().putString("gemini", k.trim()).apply()
    fun apagarChave(c: Context) = segredo(c).edit().clear().apply()
    fun modelo(c: Context): String = Store.p(c).getString("modelo", "")!!

    // ---------------- HTTP ----------------

    private fun http(url: String, corpo: String? = null, chave: String? = null, espera: Int = 45_000): String {
        val con = try {
            URL(url).openConnection() as HttpURLConnection
        } catch (e: IOException) {
            throw IaErro(0, "Sem internet agora.")
        }
        try {
            con.connectTimeout = 15_000
            con.readTimeout = espera
            con.setRequestProperty("User-Agent", UA)
            if (chave != null) con.setRequestProperty("x-goog-api-key", chave)
            if (corpo != null) {
                con.requestMethod = "POST"
                con.doOutput = true
                con.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                con.outputStream.use { it.write(corpo.toByteArray(Charsets.UTF_8)) }
            }
            val codigo = con.responseCode
            val txt = (if (codigo in 200..299) con.inputStream else con.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            if (codigo !in 200..299) throw erroHttp(codigo, txt)
            return txt
        } catch (e: SocketTimeoutException) {
            throw IaErro(504, "O Gemini demorou demais pra responder. Tenta de novo daqui a pouco.")
        } catch (e: IOException) {
            throw IaErro(0, "Sem internet agora. Tenta de novo quando conectar.")
        } finally {
            con.disconnect()
        }
    }

    private fun erroHttp(codigo: Int, txt: String): IaErro {
        val msg = try {
            JSONObject(txt).getJSONObject("error").optString("message")
        } catch (e: Exception) {
            ""
        }
        val chaveRuim = codigo == 400 && msg.contains("API key", ignoreCase = true) ||
            codigo == 401 || (codigo == 403 && msg.contains("API key", ignoreCase = true))
        return when {
            chaveRuim -> IaErro(codigo, "Essa chave não funcionou. Confira se copiou ela inteira.", true)
            codigo == 429 -> IaErro(codigo, "Acabou o limite gratuito por agora. Tenta de novo mais tarde.")
            codigo >= 500 -> IaErro(codigo, "O Gemini está sobrecarregado agora (acontece no plano grátis). Tenta de novo em alguns minutos.")
            else -> IaErro(codigo, msg.ifBlank { "Algo deu errado ($codigo)." })
        }
    }

    // ---------------- modelos ----------------

    /** Lista os modelos "flash" que a chave pode usar, do mais novo para o mais antigo. */
    private fun candidatos(c: Context, chave: String): List<String> {
        val p = Store.p(c)
        val hoje = Store.dia()
        var lista = if (p.getString("modelosDia", "") == hoje) {
            p.getString("modelos", "")!!.split(",").filter { it.isNotBlank() }
        } else emptyList()
        if (lista.isEmpty()) {
            val r = JSONObject(http("$BASE/models?pageSize=200", chave = chave))
            val arr = r.optJSONArray("models") ?: JSONArray()
            val nomes = (0 until arr.length()).map { arr.getJSONObject(it) }
                .filter { m ->
                    val metodos = m.optJSONArray("supportedGenerationMethods")
                    metodos != null && (0 until metodos.length()).any { metodos.getString(it) == "generateContent" }
                }
                .map { it.getString("name").removePrefix("models/") }
            val flash = Regex("^gemini-([0-9.]+)-flash$")
            lista = nomes.filter { flash.matches(it) }
                .sortedByDescending { versao(flash.find(it)!!.groupValues[1]) }
            if (lista.isEmpty()) {
                lista = nomes.filter {
                    it.contains("flash") && listOf("image", "tts", "audio", "live", "embedding", "thinking").none { x -> it.contains(x) }
                }
            }
            if (lista.isEmpty()) lista = listOf("gemini-2.5-flash")
            p.edit().putString("modelos", lista.joinToString(",")).putString("modelosDia", hoje).apply()
        }
        val salvo = modelo(c)
        return if (salvo in lista) listOf(salvo) + (lista - salvo) else lista
    }

    private fun versao(v: String): Double = v.split(".").let {
        (it.getOrNull(0)?.toDoubleOrNull() ?: 0.0) + (it.getOrNull(1)?.toDoubleOrNull() ?: 0.0) / 100
    }

    /** Modelos que recusaram a busca hoje (no plano grátis, a busca costuma ser liberada só em alguns). */
    private fun semBusca(c: Context): MutableSet<String> {
        val p = Store.p(c)
        if (p.getString("semBuscaDia", "") != Store.dia()) return mutableSetOf()
        return p.getString("semBusca", "")!!.split(",").filter { it.isNotBlank() }.toMutableSet()
    }

    private fun ordem(c: Context, chave: String, busca: Boolean): List<String> {
        val todos = candidatos(c, chave)
        if (!busca) return todos
        val bloqueados = semBusca(c)
        val salvo = Store.p(c).getString("modeloBusca", "")!!
        // Na nossa medição (nov/2026), a busca grátis funcionou no 2.5-flash e foi recusada nos 3.x.
        val preferidos = listOf(salvo, "gemini-2.5-flash").filter { it.isNotBlank() }
        return (preferidos + todos).distinct().filter { it !in bloqueados }
    }

    /**
     * Tenta os modelos em ordem até um responder, dentro de um orçamento de tempo.
     * Pula modelo sobrecarregado (503), sem cota (429) ou inexistente (404). Guarda o que funcionou.
     */
    private fun gerar(c: Context, chave: String, corpo: JSONObject, busca: Boolean = false, orcamento: Long = 100_000): JSONObject {
        val fim = System.currentTimeMillis() + orcamento
        var ultimo: IaErro? = null
        for (m in ordem(c, chave, busca).take(5)) {
            val resta = fim - System.currentTimeMillis()
            if (resta < 8_000) break
            try {
                val r = JSONObject(http("$BASE/models/$m:generateContent", corpo.toString(), chave, minOf(45_000L, resta).toInt()))
                Store.p(c).edit().putString(if (busca) "modeloBusca" else "modelo", m).apply()
                return r
            } catch (e: IaErro) {
                if (e.chaveRuim || e.codigo == 0) throw e
                if (busca && e.codigo == 429) {
                    val b = semBusca(c).apply { add(m) }
                    Store.p(c).edit().putString("semBusca", b.joinToString(",")).putString("semBuscaDia", Store.dia()).apply()
                }
                ultimo = e
            }
        }
        throw ultimo ?: IaErro(504, "O Gemini demorou demais pra responder. Tenta de novo daqui a pouco.")
    }

    private fun texto(r: JSONObject): String {
        val cand = r.optJSONArray("candidates")?.optJSONObject(0)
            ?: throw IaErro(-2, "O modelo não respondeu. Tenta de novo.")
        val partes = cand.optJSONObject("content")?.optJSONArray("parts") ?: JSONArray()
        val t = (0 until partes.length()).joinToString("") { partes.getJSONObject(it).optString("text") }
        if (t.isBlank()) throw IaErro(-2, "O modelo não quis responder isso. Tenta com outras palavras.")
        return t
    }

    private fun usuario(t: String) = JSONArray().put(
        JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", t)))
    )

    // ---------------- testar a chave ----------------

    fun testar(c: Context): JSONObject {
        val chave = chave(c) ?: throw IaErro(0, "Cole a chave primeiro.")
        Store.p(c).edit().remove("modelosDia").apply()
        val r = gerar(c, chave, JSONObject().put("contents", usuario("Responda apenas: ok")))
        texto(r)
        return JSONObject().put("modelo", modelo(c))
    }

    // ---------------- pacote de perguntas ----------------

    private fun descrever(t: JSONObject): String = if (t.optString("tipo") == "leitura") {
        "Leitura do livro \"${t.optString("titulo")}\"" +
            (if (t.optString("autor").isNotBlank()) " de ${t.optString("autor")}" else "") +
            ". A pessoa está no capítulo ${t.optString("capitulo", "1")}."
    } else {
        "Estudo de ${t.optString("tema")}, nível ${t.optString("nivel", "intermediário").lowercase()}." +
            (if (t.optString("topico").isNotBlank()) " Tópico atual: ${t.optString("topico")}." else "") +
            (if (t.optString("objetivo").isNotBlank()) " Objetivo: ${t.optString("objetivo")}." else "")
    }

    private fun promptPesquisa(t: JSONObject, desc: String): String = if (t.optString("tipo") == "leitura") {
        val cap = t.optString("capitulo", "1")
        "Pesquise resenhas e análises críticas deste livro. $desc\n" +
            "Escreva notas em português sobre as ideias centrais e as críticas que leitores e críticos fizeram, " +
            "considerando SOMENTE o conteúdo até o capítulo $cap. Não revele nada que aconteça depois do capítulo $cap. " +
            "Na dúvida se algo acontece antes ou depois do capítulo $cap, NÃO mencione. " +
            "Se não souber como os capítulos se dividem, fique nas ideias gerais do começo do livro. Máximo de 500 palavras."
    } else {
        "Pesquise na web e escreva notas de estudo objetivas, em português, para esta trilha. $desc\n" +
            "Inclua conceitos-chave, um ou dois exemplos curtos de código quando fizer sentido e erros comuns. " +
            "Prefira fontes confiáveis, como a documentação oficial. Máximo de 500 palavras."
    }

    /**
     * Coloca [n] no fim de cada trecho das notas que veio da fonte n (groundingSupports).
     * Assim o segundo passo sabe de qual fonte cada ideia saiu. Os índices do Google são em bytes UTF-8.
     */
    private fun marcarFontes(notas: String, supports: JSONArray?, nFontes: Int): String {
        if (supports == null || supports.length() == 0 || nFontes == 0) return notas
        val bytes = notas.toByteArray(Charsets.UTF_8)
        val marcas = sortedMapOf<Int, MutableSet<Int>>(compareByDescending { it })
        for (i in 0 until supports.length()) {
            val sup = supports.optJSONObject(i) ?: continue
            val fim = sup.optJSONObject("segment")?.optInt("endIndex", -1) ?: -1
            val idx = sup.optJSONArray("groundingChunkIndices") ?: continue
            if (fim !in 1..bytes.size) continue
            for (k in 0 until idx.length()) {
                val n = idx.optInt(k, -1)
                if (n in 0 until nFontes) marcas.getOrPut(fim) { sortedSetOf() }.add(n + 1)
            }
        }
        var out = bytes
        for ((fim, ns) in marcas) {
            val m = " [" + ns.joinToString(",") + "]"
            out = out.copyOfRange(0, fim) + m.toByteArray(Charsets.UTF_8) + out.copyOfRange(fim, out.size)
        }
        return String(out, Charsets.UTF_8)
    }

    private class Fonte(val titulo: String, val url: String, val texto: String = "")

    fun pacote(c: Context, trilha: JSONObject, existentes: JSONArray): JSONObject {
        val chave = chave(c) ?: throw IaErro(0, "Coloque sua chave do Gemini em Zoe › Inteligência.")
        val desc = descrever(trilha)
        var notas: String
        val fontes = mutableListOf<Fonte>()
        var modo: String

        // 1. pesquisa com o Google Search
        try {
            val r = gerar(c, chave, JSONObject()
                .put("contents", usuario(promptPesquisa(trilha, desc)))
                .put("tools", JSONArray().put(JSONObject().put("google_search", JSONObject()))), busca = true, orcamento = 60_000)
            val meta = r.optJSONArray("candidates")?.optJSONObject(0)?.optJSONObject("groundingMetadata")
            val chunks = meta?.optJSONArray("groundingChunks") ?: JSONArray()
            for (i in 0 until minOf(chunks.length(), 8)) {
                val w = chunks.getJSONObject(i).optJSONObject("web")
                fontes += Fonte(w?.optString("title", "Fonte") ?: "Fonte", w?.optString("uri") ?: "")
            }
            notas = marcarFontes(texto(r), meta?.optJSONArray("groundingSupports"), fontes.size)
            if (fontes.isEmpty()) throw IaErro(-1, "busca sem fontes")
            modo = "busca"
        } catch (e: IaErro) {
            if (e.chaveRuim || e.codigo == 0) throw e
            // 2. sem busca no plano gratuito: fontes abertas
            fontes.clear()
            fontes += fontesAbertas(trilha)
            notas = fontes.joinToString("\n\n") { "${it.titulo}:\n${it.texto}" }
            modo = if (fontes.isEmpty()) "sem_fonte" else "aberta"
        }
        val fontesUsadas = fontes.take(8)

        // 3. perguntas em JSON
        val prompt = promptPerguntas(trilha, desc, notas, fontesUsadas, existentes)
        val base = JSONObject().put("contents", usuario(prompt))
        val r = try {
            gerar(c, chave, JSONObject(base.toString()).put("generationConfig", JSONObject()
                .put("responseMimeType", "application/json")
                .put("responseSchema", esquema())))
        } catch (e: IaErro) {
            if (e.chaveRuim || e.codigo == 0 || e.codigo == 429) throw e
            gerar(c, chave, base)
        }
        val lista = lerLista(texto(r))
        val perguntas = JSONArray()
        for (i in 0 until lista.length()) {
            val q = lista.optJSONObject(i) ?: continue
            val pergunta = q.optString("pergunta").trim()
            if (pergunta.isEmpty()) continue
            val n = q.optInt("fonte", 0)
            val fonte = fontesUsadas.getOrNull(n - 1)
            perguntas.put(JSONObject()
                .put("tipo", q.optString("tipo", "conceito"))
                .put("pergunta", pergunta)
                .put("codigo", q.optString("codigo").trim())
                .put("citacao", q.optString("citacao").trim())
                .put("dica", q.optString("dica").trim())
                .put("resposta", q.optString("resposta").trim())
                .put("explicacao", q.optString("explicacao").trim())
                .put("dificuldade", q.optInt("dificuldade", 1).coerceIn(1, 3))
                .put("fonte", if (fonte != null && fonte.url.isNotBlank()) JSONObject().put("titulo", fonte.titulo).put("url", fonte.url) else JSONObject.NULL))
        }
        if (perguntas.length() == 0) throw IaErro(-2, "Não consegui montar perguntas desta vez. Tenta de novo.")
        val finais = if (trilha.optString("tipo") == "leitura") semSpoiler(c, chave, trilha, perguntas) else perguntas
        if (finais.length() == 0) throw IaErro(-2, "Todas as perguntas tinham spoiler, então joguei fora. Tenta de novo.")
        return JSONObject().put("perguntas", finais).put("modo", modo).put("modelo", modelo(c))
    }

    /**
     * Livros: uma segunda olhada só para tirar spoiler. Um pedido focado nisso erra menos do que a geração.
     * Se a checagem falhar, devolve as perguntas sem filtrar (melhor que perder o pacote).
     */
    private fun semSpoiler(c: Context, chave: String, t: JSONObject, perguntas: JSONArray): JSONArray {
        val cap = t.optString("capitulo", "1")
        val lista = (0 until perguntas.length()).joinToString("\n") { i ->
            val q = perguntas.getJSONObject(i)
            "${i + 1}. " + listOf(q.optString("citacao"), q.optString("pergunta"), q.optString("resposta")).filter { it.isNotBlank() }.joinToString(" / ")
        }
        val prompt = "Você revisa perguntas para quem está lendo \"${t.optString("titulo")}\"" +
            (if (t.optString("autor").isNotBlank()) " de ${t.optString("autor")}" else "") +
            " e parou no capítulo $cap. Pense em como o livro se divide em capítulos e no que acontece em cada um. " +
            "Marque como spoiler qualquer pergunta que mencione ou insinue algo revelado depois do capítulo $cap " +
            "(revelações, passado de personagens, reviravoltas, desfecho). Na dúvida, marque como spoiler.\n\n" +
            "PERGUNTAS:\n$lista\n\nResponda com um array JSON com os números das perguntas SEGURAS."
        return try {
            val r = gerar(c, chave, JSONObject().put("contents", usuario(prompt)).put("generationConfig", JSONObject()
                .put("responseMimeType", "application/json")
                .put("responseSchema", JSONObject().put("type", "ARRAY").put("items", JSONObject().put("type", "INTEGER")))),
                orcamento = 45_000)
            val seguras = lerLista(texto(r))
            val ok = (0 until seguras.length()).map { seguras.optInt(it, 0) }.toSet()
            JSONArray().apply { for (i in 0 until perguntas.length()) if ((i + 1) in ok) put(perguntas.get(i)) }
        } catch (e: IaErro) {
            if (e.chaveRuim) throw e
            perguntas
        }
    }

    private fun promptPerguntas(t: JSONObject, desc: String, notas: String, fontes: List<Fonte>, existentes: JSONArray): String {
        val leitura = t.optString("tipo") == "leitura"
        val cap = t.optString("capitulo", "1")
        val regras = if (leitura) {
            "- Tipos: \"contraponto\" (traga uma crítica ou opinião de resenha no campo \"citacao\" e pergunte se a pessoa concorda), " +
                "\"conexao\" (ligue uma ideia do livro à vida ou a outro assunto) e \"frase\" (peça para resumir uma ideia em uma frase).\n" +
                "- Não existe resposta certa: em \"resposta\" escreva um jeito de pensar, curto.\n" +
                "- NUNCA revele nada depois do capítulo $cap: nem reviravoltas, nem revelações, nem o destino dos personagens. " +
                "Na dúvida se algo acontece antes ou depois desse capítulo, não use.\n" +
                "- Citações: no máximo 2 frases, sem aspas no campo \"citacao\"."
        } else {
            "- Tipos: \"conceito\", \"codigo\" (um trecho curto no campo \"codigo\", perguntando o que ele faz ou imprime) e \"erro\" (uma armadilha comum).\n" +
                "- \"resposta\": a resposta certa, curta. \"explicacao\": até 2 frases.\n" +
                "- Comece pelo nível da pessoa e varie a dificuldade."
        }
        val ja = (0 until minOf(existentes.length(), 40)).joinToString("\n") { "- " + existentes.optString(it) }
        val listaFontes = if (fontes.isEmpty()) "(nenhuma)" else fontes.mapIndexed { i, f -> "${i + 1}. ${f.titulo} — ${f.url}" }.joinToString("\n")
        return "Você é a Zoe, uma parceira de estudo que faz a pessoa pensar em vez de entregar respostas.\n" +
            "Crie $PERGUNTAS_POR_PACOTE perguntas para esta trilha: $desc\n\nRegras:\n" +
            "- Português do Brasil, frases curtas.\n$regras\n" +
            "- \"dica\": uma pista que não entrega a resposta.\n" +
            "- \"dificuldade\": 1 (fácil) a 3 (difícil).\n" +
            "- \"fonte\": as NOTAS têm marcas [n] dizendo de qual fonte veio cada trecho. Use o número da fonte do trecho em que a pergunta se baseia (1 a ${fontes.size}). Use 0 só se a pergunta não vier de nenhum trecho marcado. Nunca invente fontes.\n" +
            (if (ja.isNotBlank()) "- Não repita estas perguntas:\n$ja\n" else "") +
            "\nNOTAS:\n${notas.take(12_000)}\n\nFONTES:\n$listaFontes\n\n" +
            "Responda só com um array JSON de objetos com os campos: tipo, pergunta, codigo, citacao, dica, resposta, explicacao, fonte, dificuldade."
    }

    private fun esquema(): JSONObject {
        fun tipo(t: String) = JSONObject().put("type", t)
        val props = JSONObject()
        listOf("tipo", "pergunta", "codigo", "citacao", "dica", "resposta", "explicacao").forEach { props.put(it, tipo("STRING")) }
        props.put("fonte", tipo("INTEGER")).put("dificuldade", tipo("INTEGER"))
        return JSONObject().put("type", "ARRAY").put("items", JSONObject()
            .put("type", "OBJECT")
            .put("properties", props)
            .put("required", JSONArray(listOf("tipo", "pergunta", "dica", "resposta", "fonte", "dificuldade"))))
    }

    /** Lê o array JSON mesmo que venha dentro de ```json ... ```. */
    fun lerLista(t: String): JSONArray {
        val ini = t.indexOf('[')
        val fim = t.lastIndexOf(']')
        if (ini < 0 || fim <= ini) throw IaErro(0, "Resposta veio num formato estranho. Tenta de novo.")
        return try {
            JSONArray(t.substring(ini, fim + 1))
        } catch (e: Exception) {
            throw IaErro(0, "Resposta veio num formato estranho. Tenta de novo.")
        }
    }

    // ---------------- fontes abertas (sem chave) ----------------

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun fontesAbertas(t: JSONObject): List<Fonte> {
        val out = mutableListOf<Fonte>()
        if (t.optString("tipo") == "leitura") {
            try {
                out += openLibrary(t.optString("titulo"), t.optString("autor"))
            } catch (e: Exception) { /* segue sem */ }
            val w = wikipedia("pt", "${t.optString("titulo")} livro ${t.optString("autor")}".trim(), 2)
            out += w.ifEmpty { listOfNotNull(resumoWiki("pt", t.optString("titulo"))) }
        } else {
            val q = listOf(t.optString("tema"), t.optString("topico")).filter { it.isNotBlank() }.joinToString(" ")
            out += wikipedia("pt", q, 3)
            if (out.isEmpty()) out += wikipedia("en", q, 3)
            if (out.isEmpty()) out += listOfNotNull(resumoWiki("pt", t.optString("tema")), resumoWiki("en", t.optString("tema")))
        }
        return out
    }

    private fun wikipedia(lingua: String, busca: String, n: Int): List<Fonte> = try {
        val url = "https://$lingua.wikipedia.org/w/api.php?action=query&format=json&generator=search" +
            "&gsrsearch=${enc(busca)}&gsrlimit=$n&prop=extracts&exintro=1&explaintext=1&exlimit=$n"
        val pages = JSONObject(http(url, espera = 15_000)).optJSONObject("query")?.optJSONObject("pages") ?: JSONObject()
        pages.keys().asSequence().map { pages.getJSONObject(it) }
            .sortedBy { it.optInt("index", 99) }
            .filter { it.optString("extract").length > 80 }
            .map {
                val titulo = it.getString("title")
                Fonte("Wikipedia: $titulo", "https://$lingua.wikipedia.org/wiki/${enc(titulo.replace(' ', '_')).replace("+", "%20")}", it.optString("extract").take(3500))
            }.toList()
    } catch (e: Exception) {
        emptyList()
    }

    /** Resumo direto de uma página (não usa a busca da Wikipedia, que às vezes fica ocupada). */
    private fun resumoWiki(lingua: String, titulo: String): Fonte? = try {
        if (titulo.isBlank()) null else {
            val nome = enc(titulo.trim().replace(' ', '_')).replace("+", "%20")
            val o = JSONObject(http("https://$lingua.wikipedia.org/api/rest_v1/page/summary/$nome", espera = 15_000))
            val txt = o.optString("extract")
            if (txt.length < 80) null
            else Fonte("Wikipedia: ${o.optString("title", titulo)}", "https://$lingua.wikipedia.org/wiki/$nome", txt.take(3500))
        }
    } catch (e: Exception) {
        null
    }

    private fun openLibrary(titulo: String, autor: String): List<Fonte> {
        val q = "https://openlibrary.org/search.json?limit=1&fields=key,title,author_name&title=${enc(titulo)}" +
            (if (autor.isNotBlank()) "&author=${enc(autor)}" else "")
        val doc = JSONObject(http(q)).optJSONArray("docs")?.optJSONObject(0) ?: return emptyList()
        val chave = doc.optString("key")
        if (chave.isBlank()) return emptyList()
        val obra = JSONObject(http("https://openlibrary.org$chave.json"))
        val d = obra.opt("description")
        val texto = when (d) {
            is JSONObject -> d.optString("value")
            is String -> d
            else -> ""
        }
        val assuntos = obra.optJSONArray("subjects")?.let { a -> (0 until minOf(a.length(), 12)).joinToString(", ") { a.getString(it) } } ?: ""
        if (texto.isBlank() && assuntos.isBlank()) return emptyList()
        return listOf(Fonte("Open Library: ${doc.optString("title")}", "https://openlibrary.org$chave",
            (texto + if (assuntos.isNotBlank()) "\nAssuntos: $assuntos" else "").take(3500)))
    }

    // ---------------- conversa socrática ----------------

    fun conversar(c: Context, trilha: JSONObject, historico: JSONArray): JSONObject {
        val chave = chave(c) ?: throw IaErro(0, "Coloque sua chave do Gemini em Zoe › Inteligência.")
        if (Store.conversasHoje(c) >= Store.MAX_CONVERSA) {
            throw IaErro(0, "Chega de conversa por hoje: o limite é de ${Store.MAX_CONVERSA} mensagens. Amanhã tem mais!")
        }
        val leitura = trilha.optString("tipo") == "leitura"
        val sistema = "Você é a Zoe, um orbe de cristal roxo, simpática e direta, parceira de estudo. " +
            "Use o modo socrático: em vez de entregar a resposta, faça UMA pergunta que leve a pessoa a descobrir sozinha. " +
            "Se a pessoa pedir \"me explica direto\", explique de forma clara. Se pedir um exemplo, dê um exemplo curto. " +
            "Respostas curtas (até 4 frases), português do Brasil, sem títulos nem listas longas; código entre crases. " +
            "Fique no tema desta trilha: ${descrever(trilha)}" +
            (if (leitura) " Nunca revele nada depois do capítulo ${trilha.optString("capitulo", "1")}." else "")
        val contents = JSONArray()
        val inicio = maxOf(0, historico.length() - 14)
        for (i in inicio until historico.length()) {
            val m = historico.getJSONObject(i)
            contents.put(JSONObject()
                .put("role", if (m.optBoolean("eu")) "user" else "model")
                .put("parts", JSONArray().put(JSONObject().put("text", m.optString("texto")))))
        }
        val r = gerar(c, chave, JSONObject()
            .put("system_instruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", sistema))))
            .put("contents", contents))
        val t = texto(r).trim()
        Store.contarConversa(c)
        return JSONObject().put("texto", t).put("restantes", Store.MAX_CONVERSA - Store.conversasHoje(c))
    }
}
