package com.openchat.onnximagegen

import kotlin.math.pow
import kotlin.math.sqrt

/**
 * Karras sigma schedule + Euler step for Stable Diffusion 1.5 (diffusers
 * EulerDiscreteScheduler, prediction_type="epsilon", use_karras_sigmas=true,
 * final_sigmas_type="zero"). Ported from the ondevice-imagen reference.
 */
class DpmScheduler(
    private val numTrainTimesteps: Int = 1000,
    private val betaStart: Float = 0.00085f,
    private val betaEnd: Float = 0.012f,
) {
    val trainingSigmas: FloatArray

    init {
        val betas = FloatArray(numTrainTimesteps) { i ->
            val t = i.toFloat() / (numTrainTimesteps - 1).toFloat()
            val sqrtBeta = sqrt(betaStart) + t * (sqrt(betaEnd) - sqrt(betaStart))
            sqrtBeta * sqrtBeta
        }
        val alphasCumprod = FloatArray(numTrainTimesteps)
        var prod = 1.0f
        for (i in 0 until numTrainTimesteps) {
            prod *= (1f - betas[i])
            alphasCumprod[i] = prod
        }
        trainingSigmas = FloatArray(numTrainTimesteps) { i ->
            sqrt((1f - alphasCumprod[i]) / alphasCumprod[i])
        }
    }

    fun karrasSigmas(numInferenceSteps: Int, rho: Float = 7f): FloatArray {
        require(numInferenceSteps >= 2) { "need at least 2 inference steps" }
        val sigmaMin = trainingSigmas.first()
        val sigmaMax = trainingSigmas.last()
        val invRho = 1f / rho
        val sigmaMaxRho = sigmaMax.pow(invRho)
        val sigmaMinRho = sigmaMin.pow(invRho)
        val out = FloatArray(numInferenceSteps + 1)
        for (i in 0 until numInferenceSteps) {
            val ramp = i.toFloat() / (numInferenceSteps - 1).toFloat()
            val sigRho = sigmaMaxRho + ramp * (sigmaMinRho - sigmaMaxRho)
            out[i] = sigRho.pow(rho)
        }
        out[numInferenceSteps] = 0f
        return out
    }

    fun stepEuler(
        sample: FloatArray,
        noisePred: FloatArray,
        sigmaCurrent: Float,
        sigmaNext: Float,
    ): FloatArray {
        require(sample.size == noisePred.size) { "size mismatch" }
        val dt = sigmaNext - sigmaCurrent
        val out = FloatArray(sample.size)
        for (i in out.indices) out[i] = sample[i] + dt * noisePred[i]
        return out
    }

    fun karrasTimesteps(sigmas: FloatArray): IntArray {
        val out = IntArray(sigmas.size - 1)
        for (k in 0 until sigmas.size - 1) {
            val target = sigmas[k]
            var bestI = 0
            var bestDist = Float.POSITIVE_INFINITY
            for (i in 0 until trainingSigmas.size) {
                val d = kotlin.math.abs(trainingSigmas[i] - target)
                if (d < bestDist) {
                    bestDist = d
                    bestI = i
                }
            }
            out[k] = bestI
        }
        return out
    }
}
