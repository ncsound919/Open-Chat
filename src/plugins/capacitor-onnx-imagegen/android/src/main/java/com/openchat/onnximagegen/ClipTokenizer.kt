package com.openchat.onnximagegen

import org.json.JSONObject
import java.io.File

/**
 * Minimal CLIP byte-level BPE tokenizer (OpenAI simple_tokenizer.py /
 * HF CLIPTokenizer). Loads vocab.json + merges.txt from the ONNX bundle's
 * tokenizer/ dir. Ported from the ondevice-imagen reference.
 */
class ClipTokenizer(tokenizerDir: File) {

    private val bosTokenId: Int
    private val eosTokenId: Int
    private val padTokenId: Int

    private val encoder: Map<String, Int>
    private val bpeRanks: Map<Pair<String, String>, Int>
    private val byteEncoder: Map<Int, Char>

    private val cache = HashMap<String, String>()

    private val PAT = Regex(
        """<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|""" +
            """[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+""",
        RegexOption.IGNORE_CASE,
    )

    init {
        val vocabFile = File(tokenizerDir, "vocab.json")
        require(vocabFile.exists()) { "vocab.json missing at $vocabFile" }
        val vocabJson = JSONObject(vocabFile.readText(Charsets.UTF_8))
        val map = HashMap<String, Int>(vocabJson.length() + 8)
        for (key in vocabJson.keys()) map[key] = vocabJson.getInt(key)
        encoder = map

        val mergesFile = File(tokenizerDir, "merges.txt")
        require(mergesFile.exists()) { "merges.txt missing at $mergesFile" }
        val rankMap = HashMap<Pair<String, String>, Int>()
        mergesFile.readLines(Charsets.UTF_8)
            .drop(1)
            .filter { it.isNotBlank() }
            .forEachIndexed { idx, line ->
                val parts = line.split(' ')
                if (parts.size == 2) rankMap[Pair(parts[0], parts[1])] = idx
            }
        bpeRanks = rankMap

        byteEncoder = bytesToUnicode()

        bosTokenId = encoder["<|startoftext|>"] ?: error("vocab.json missing <|startoftext|>")
        eosTokenId = encoder["<|endoftext|>"] ?: error("vocab.json missing <|endoftext|>")
        padTokenId = eosTokenId
    }

    fun encode(text: String, maxLength: Int = 77): IntArray {
        val cleaned = text.replace(Regex("\\s+"), " ").trim().lowercase()
        val bpeTokens = ArrayList<Int>(maxLength)
        for (match in PAT.findAll(cleaned)) {
            val bytes = match.value.toByteArray(Charsets.UTF_8)
            val tokenStr = buildString(bytes.size) {
                for (b in bytes) append(byteEncoder[b.toInt() and 0xFF])
            }
            for (piece in bpe(tokenStr).split(' ')) {
                bpeTokens.add(encoder[piece] ?: error("BPE piece '$piece' not in vocab"))
            }
        }
        val out = IntArray(maxLength) { padTokenId }
        out[0] = bosTokenId
        val bodyLen = minOf(bpeTokens.size, maxLength - 2)
        for (i in 0 until bodyLen) out[i + 1] = bpeTokens[i]
        out[bodyLen + 1] = eosTokenId
        return out
    }

    private fun bpe(token: String): String {
        cache[token]?.let { return it }
        val word = ArrayList<String>(token.length)
        for (i in 0 until token.length - 1) word.add(token[i].toString())
        word.add(token[token.length - 1].toString() + "</w>")
        while (word.size >= 2) {
            var bestRank = Int.MAX_VALUE
            var bestI = -1
            for (i in 0 until word.size - 1) {
                val rank = bpeRanks[Pair(word[i], word[i + 1])] ?: continue
                if (rank < bestRank) {
                    bestRank = rank
                    bestI = i
                }
            }
            if (bestI < 0) break
            val first = word[bestI]
            val second = word[bestI + 1]
            val merged = first + second
            val next = ArrayList<String>(word.size)
            var i = 0
            while (i < word.size) {
                if (i < word.size - 1 && word[i] == first && word[i + 1] == second) {
                    next.add(merged)
                    i += 2
                } else {
                    next.add(word[i])
                    i += 1
                }
            }
            word.clear()
            word.addAll(next)
        }
        val result = word.joinToString(" ")
        cache[token] = result
        return result
    }

    private fun bytesToUnicode(): Map<Int, Char> {
        val bs = ArrayList<Int>(256)
        for (b in 0x21..0x7E) bs.add(b)
        for (b in 0xA1..0xAC) bs.add(b)
        for (b in 0xAE..0xFF) bs.add(b)
        val cs = ArrayList<Int>(bs)
        var n = 0
        for (b in 0..255) {
            if (b !in bs) {
                bs.add(b)
                cs.add(256 + n)
                n += 1
            }
        }
        val out = HashMap<Int, Char>(256)
        for (i in bs.indices) out[bs[i]] = cs[i].toChar()
        return out
    }

    companion object {
        const val MAX_LENGTH = 77
    }
}
