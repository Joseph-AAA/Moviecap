package expo.modules.moviecapffmpeg

import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFprobeKit
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import kotlin.math.abs

private const val PROGRESS_EVENT = "onProgress"
private const val LOG_TAIL_CHARS = 4000

class FfmpegFailedException(message: String) :
  CodedException("ERR_FFMPEG_FAILED", message, null)

class FfmpegCancelledException :
  CodedException("ERR_FFMPEG_CANCELLED", "Rendering was cancelled.", null)

class ProbeFailedException(message: String) :
  CodedException("ERR_FFPROBE_FAILED", message, null)

/**
 * Thin wrapper around the FFmpegKit build that react-native-video-trim
 * already bundles. Only runs commands that the app builds itself
 * (see src/services/render/renderCommand.ts); never touches source files.
 */
class MoviecapFfmpegModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MoviecapFfmpeg")

    Events(PROGRESS_EVENT)

    /**
     * Read the facts the renderer needs. Width/height are the DISPLAY size
     * (already swapped for 90/270° rotation), because FFmpeg auto-rotates
     * frames when decoding.
     */
    AsyncFunction("probe") { path: String, promise: Promise ->
      Thread {
        try {
          val session = FFprobeKit.getMediaInformation(path)
          val info = session.mediaInformation
            ?: throw ProbeFailedException("Could not read video information.")

          val streams = info.streams ?: emptyList()
          val video = streams.firstOrNull { it.type == "video" }
            ?: throw ProbeFailedException("The file has no video track.")
          val hasAudio = streams.any { it.type == "audio" }

          val rotation = readRotation(video.allProperties, video.tags)
          val rawWidth = video.width ?: 0L
          val rawHeight = video.height ?: 0L
          val swap = abs(rotation) % 180 == 90

          promise.resolve(
            mapOf(
              "width" to (if (swap) rawHeight else rawWidth).toInt(),
              "height" to (if (swap) rawWidth else rawHeight).toInt(),
              "rotation" to rotation,
              "frameRate" to parseFrameRate(video.realFrameRate),
              "duration" to (info.duration?.toDoubleOrNull() ?: 0.0),
              "videoBitrate" to (video.bitrate?.toLongOrNull()
                ?: info.bitrate?.toLongOrNull() ?: 0L).toDouble(),
              "hasAudio" to hasAudio,
            ),
          )
        } catch (e: CodedException) {
          promise.reject(e)
        } catch (e: Exception) {
          promise.reject(ProbeFailedException(e.message ?: "Probe failed."))
        }
      }.start()
    }

    /**
     * Run FFmpeg with an argument array (no shell parsing, so paths with
     * spaces are safe). Emits onProgress { jobId, timeMs } while running.
     * Resolves { sessionId, logTail } on success; rejects on failure/cancel.
     */
    AsyncFunction("execute") { jobId: String, args: List<String>, promise: Promise ->
      FFmpegKit.executeWithArgumentsAsync(
        args.toTypedArray(),
        { session ->
          val code = session.returnCode
          val logTail = session.allLogsAsString?.takeLast(LOG_TAIL_CHARS) ?: ""
          when {
            code != null && code.isValueSuccess -> promise.resolve(
              mapOf("sessionId" to session.sessionId.toDouble(), "logTail" to logTail),
            )
            code != null && code.isValueCancel -> promise.reject(FfmpegCancelledException())
            else -> promise.reject(
              FfmpegFailedException(
                "FFmpeg failed (code ${code?.value}).\n" +
                  (session.failStackTrace ?: logTail),
              ),
            )
          }
        },
        null,
        { stats ->
          sendEvent(
            PROGRESS_EVENT,
            mapOf(
              "jobId" to jobId,
              "sessionId" to stats.sessionId.toDouble(),
              "timeMs" to stats.time,
            ),
          )
        },
      )
    }

    /** Cancel one session (or all FFmpeg work when sessionId is null). */
    Function("cancel") { sessionId: Double? ->
      if (sessionId == null) FFmpegKit.cancel() else FFmpegKit.cancel(sessionId.toLong())
    }
  }

  private fun readRotation(properties: JSONObject?, tags: JSONObject?): Int {
    // Newer FFmpeg: side_data_list[].rotation ; older: tags.rotate
    val sideData = properties?.optJSONArray("side_data_list")
    if (sideData != null) {
      for (i in 0 until sideData.length()) {
        val entry = sideData.optJSONObject(i) ?: continue
        if (entry.has("rotation")) return entry.optInt("rotation", 0)
      }
    }
    return tags?.optString("rotate")?.toIntOrNull() ?: 0
  }

  private fun parseFrameRate(value: String?): Double {
    if (value.isNullOrBlank()) return 0.0
    val parts = value.split("/")
    return if (parts.size == 2) {
      val num = parts[0].toDoubleOrNull() ?: 0.0
      val den = parts[1].toDoubleOrNull() ?: 0.0
      if (den > 0) num / den else 0.0
    } else {
      value.toDoubleOrNull() ?: 0.0
    }
  }
}
