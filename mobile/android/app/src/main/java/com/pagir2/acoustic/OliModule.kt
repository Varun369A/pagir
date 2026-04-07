/**
 * TARANG-OLI (தரங்க்-ஒலி) — Acoustic Mesh Transport
 *
 * OLI = ஒலி = Sound (Tamil)
 *
 * Uses phone speaker + microphone to transmit PAGIR frames
 * as FSK (Frequency Shift Keying) audio signals.
 *
 * Frequencies:
 *   Preamble sync : 17,000 Hz  (3 pulses, 46ms each)
 *   Bit 0         : 18,000 Hz  (23ms per bit)
 *   Bit 1         : 19,000 Hz  (23ms per bit)
 *   Postamble     : 17,500 Hz  (46ms)
 *
 * Data rate: ~43 bits/sec = ~5 bytes/sec
 * Range    : 50-500m (phone speaker), up to 5km (clip-on)
 * Latency  : near-zero (speed of sound)
 *
 * Used by MeshRouter as Transport Layer 5 (after BLE, before store-carry-forward)
 */

package com.pagir2.acoustic

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlin.math.*
import kotlin.concurrent.thread

class OliModule(private val reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "OliModule"

    // ─── Protocol constants ───────────────────────────────────────────────────

    private val SAMPLE_RATE    = 44100
    private val SAMPLES_PER_BIT= 1024        // ~23ms per bit
    private val FREQ_SYNC      = 17000.0     // preamble sync frequency
    private val FREQ_POSTSYNC  = 17500.0     // postamble frequency
    private val FREQ_ZERO      = 18000.0     // bit 0
    private val FREQ_ONE       = 19000.0     // bit 1
    private val AMPLITUDE      = 0.95        // near max volume
    private val SYNC_PULSES    = 3           // number of preamble pulses
    private val GOERTZEL_THRESHOLD = 8_000_000.0  // detection threshold

    // ─── State ────────────────────────────────────────────────────────────────

    @Volatile private var listening  = false
    @Volatile private var transmitting = false
    private var recordThread: Thread? = null

    // ─── Tone generation ──────────────────────────────────────────────────────

    private fun generateTone(freq: Double, samples: Int): ShortArray {
        return ShortArray(samples) { i ->
            (sin(2.0 * PI * freq * i / SAMPLE_RATE) * Short.MAX_VALUE * AMPLITUDE).toInt().toShort()
        }
    }

    private fun generateSilence(samples: Int): ShortArray = ShortArray(samples) { 0 }

    // ─── Goertzel detector — efficient single-frequency power measurement ─────

    private fun goertzel(samples: ShortArray, targetFreq: Double): Double {
        val omega  = 2.0 * PI * targetFreq / SAMPLE_RATE
        val coeff  = 2.0 * cos(omega)
        var q0 = 0.0; var q1 = 0.0; var q2 = 0.0
        for (s in samples) {
            q0 = coeff * q1 - q2 + s
            q2 = q1; q1 = q0
        }
        return q1 * q1 + q2 * q2 - q1 * q2 * coeff
    }

    private fun detectFreq(samples: ShortArray, freq: Double): Boolean =
        goertzel(samples, freq) > GOERTZEL_THRESHOLD

    // ─── FSK Encoder: bytes → audio samples ──────────────────────────────────

    private fun encodeFrame(data: ByteArray): ShortArray {
        val parts = mutableListOf<ShortArray>()

        // Preamble: SYNC_PULSES sync tones + short silence
        repeat(SYNC_PULSES) {
            parts.add(generateTone(FREQ_SYNC, SAMPLES_PER_BIT * 2))
            parts.add(generateSilence(SAMPLES_PER_BIT / 4))
        }
        parts.add(generateSilence(SAMPLES_PER_BIT / 2))  // framing gap

        // Length prefix (2 bytes, big-endian)
        val len = data.size
        val header = byteArrayOf((len shr 8).toByte(), (len and 0xFF).toByte())

        // Data bytes → bits → tones
        for (byte in header + data) {
            for (bitIdx in 7 downTo 0) {
                val bit = (byte.toInt() shr bitIdx) and 1
                val freq = if (bit == 0) FREQ_ZERO else FREQ_ONE
                parts.add(generateTone(freq, SAMPLES_PER_BIT))
            }
        }

        // CRC16 (2 bytes)
        val crc = crc16(data)
        for (byte in byteArrayOf((crc shr 8).toByte(), (crc and 0xFF).toByte())) {
            for (bitIdx in 7 downTo 0) {
                val bit = (byte.toInt() shr bitIdx) and 1
                parts.add(generateTone(if (bit == 0) FREQ_ZERO else FREQ_ONE, SAMPLES_PER_BIT))
            }
        }

        // Postamble
        parts.add(generateSilence(SAMPLES_PER_BIT / 2))
        parts.add(generateTone(FREQ_POSTSYNC, SAMPLES_PER_BIT * 2))

        // Concatenate all parts
        val total = parts.sumOf { it.size }
        val out   = ShortArray(total)
        var pos   = 0
        for (p in parts) { p.copyInto(out, pos); pos += p.size }
        return out
    }

    // ─── FSK Decoder ─────────────────────────────────────────────────────────

    private fun decodeFrame(buffer: ShortArray, startIdx: Int, totalLen: Int): ByteArray? {
        // Read length prefix (2 bytes = 16 bits)
        var bitPos = startIdx
        var lenVal = 0
        for (i in 0 until 16) {
            val slice = buffer.copyOfRange(bitPos, minOf(bitPos + SAMPLES_PER_BIT, buffer.size))
            val isOne = goertzel(slice, FREQ_ONE) > goertzel(slice, FREQ_ZERO)
            lenVal = (lenVal shl 1) or (if (isOne) 1 else 0)
            bitPos += SAMPLES_PER_BIT
        }

        if (lenVal <= 0 || lenVal > 4096) return null  // sanity check

        // Read data bytes
        val data = ByteArray(lenVal)
        for (byteIdx in 0 until lenVal) {
            var byteVal = 0
            for (bitIdx in 7 downTo 0) {
                if (bitPos + SAMPLES_PER_BIT > buffer.size) return null
                val slice  = buffer.copyOfRange(bitPos, bitPos + SAMPLES_PER_BIT)
                val isOne  = goertzel(slice, FREQ_ONE) > goertzel(slice, FREQ_ZERO)
                byteVal    = (byteVal shl 1) or (if (isOne) 1 else 0)
                bitPos    += SAMPLES_PER_BIT
            }
            data[byteIdx] = byteVal.toByte()
        }

        // Read + verify CRC (2 bytes)
        var rxCrc = 0
        for (i in 0 until 16) {
            if (bitPos + SAMPLES_PER_BIT > buffer.size) return null
            val slice = buffer.copyOfRange(bitPos, bitPos + SAMPLES_PER_BIT)
            val isOne = goertzel(slice, FREQ_ONE) > goertzel(slice, FREQ_ZERO)
            rxCrc     = (rxCrc shl 1) or (if (isOne) 1 else 0)
            bitPos   += SAMPLES_PER_BIT
        }

        val expectedCrc = crc16(data)
        if (rxCrc != expectedCrc) return null  // corrupted frame

        return data
    }

    // ─── CRC16 ────────────────────────────────────────────────────────────────

    private fun crc16(data: ByteArray): Int {
        var crc = 0xFFFF
        for (b in data) {
            crc = crc xor (b.toInt() and 0xFF)
            repeat(8) {
                crc = if (crc and 1 != 0) (crc ushr 1) xor 0xA001 else crc ushr 1
            }
        }
        return crc and 0xFFFF
    }

    // ─── React Native API ─────────────────────────────────────────────────────

    @ReactMethod
    fun transmit(base64Data: String, promise: Promise) {
        if (transmitting) { promise.reject("BUSY", "Already transmitting"); return }

        thread(name = "OliTx") {
            transmitting = true
            try {
                val data    = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)
                val samples = encodeFrame(data)

                val track = AudioTrack.Builder()
                    .setAudioAttributes(AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build())
                    .setAudioFormat(AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build())
                    .setBufferSizeInBytes(samples.size * 2)
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .build()

                track.write(samples, 0, samples.size)
                track.play()

                // Wait for playback to complete
                val durationMs = (samples.size.toLong() * 1000L / SAMPLE_RATE)
                Thread.sleep(durationMs + 100)

                track.stop()
                track.release()

                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("TX_ERROR", e.message)
            } finally {
                transmitting = false
            }
        }
    }

    @ReactMethod
    fun startListening(promise: Promise) {
        if (listening) { promise.resolve(null); return }

        val minBuf = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        // Use 4x min buffer to reduce overruns
        val bufSize = maxOf(minBuf, SAMPLES_PER_BIT * 64) * 4

        val recorder = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufSize
            )
        } catch (e: Exception) {
            promise.reject("MIC_ERROR", "Cannot open microphone: ${e.message}")
            return
        }

        listening = true
        recorder.startRecording()

        recordThread = thread(name = "OliRx") {
            // Ring buffer — hold last 4 seconds of audio for frame detection
            val windowSamples = SAMPLE_RATE * 4
            val window        = ShortArray(windowSamples)
            var writePos      = 0
            val readBuf       = ShortArray(bufSize / 2)

            while (listening) {
                val read = recorder.read(readBuf, 0, readBuf.size)
                if (read <= 0) continue

                // Copy into circular window
                for (i in 0 until read) {
                    window[writePos % windowSamples] = readBuf[i]
                    writePos++
                }

                // Scan for preamble sync tone in latest chunk
                val latest = readBuf.copyOf(read)
                if (!detectFreq(latest, FREQ_SYNC)) continue

                // Preamble detected — extract frame starting after preamble
                // Skip past all sync pulses + gap
                val skipSamples = SAMPLES_PER_BIT * 2 * SYNC_PULSES +
                                  SAMPLES_PER_BIT / 4 * SYNC_PULSES +
                                  SAMPLES_PER_BIT / 2

                // Build a flat window from ring buffer starting at preamble detection
                val startPos  = maxOf(0, writePos - read - skipSamples)
                val flatWindow = ShortArray(windowSamples)
                for (i in 0 until windowSamples) {
                    flatWindow[i] = window[(startPos + i) % windowSamples]
                }

                val decoded = decodeFrame(flatWindow, 0, flatWindow.size) ?: continue

                // Emit to JS
                val b64 = android.util.Base64.encodeToString(decoded, android.util.Base64.NO_WRAP)
                emitEvent("OliFrame", b64)
            }

            recorder.stop()
            recorder.release()
        }

        promise.resolve(null)
    }

    @ReactMethod
    fun stopListening(promise: Promise) {
        listening = false
        recordThread?.join(2000)
        recordThread = null
        promise.resolve(null)
    }

    // ─── Event emission ───────────────────────────────────────────────────────

    private fun emitEvent(name: String, data: String) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(name, data)
    }

    @ReactMethod
    fun addListener(eventName: String) {}  // required by RN

    @ReactMethod
    fun removeListeners(count: Int) {}     // required by RN
}
