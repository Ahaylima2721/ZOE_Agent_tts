package com.zoefoco.app

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.AppOpsManager
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import org.json.JSONObject

/**
 * As permissões da Zoe, em três níveis:
 *  - essenciais: sem elas o peteleco não funciona (ver o app aberto, aparecer por cima);
 *  - recomendadas: deixam a Zoe confiável (notificações, alarme no horário, bateria);
 *  - futuras: não pedimos agora (acessibilidade, para bloquear só Reels e Shorts).
 */
object Perms {
    const val USO = "uso"
    const val SOBREPOR = "sobrepor"
    const val NOTIFICACOES = "notificacoes"
    const val ALARMES = "alarmes"
    const val BATERIA = "bateria"
    const val INICIO_AUTO = "inicioAuto"

    private const val REQ_NOTIF = 41

    fun uso(c: Context): Boolean {
        val ops = c.getSystemService(AppOpsManager::class.java)
        val modo = if (Build.VERSION.SDK_INT >= 29) {
            ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.packageName)
        } else {
            @Suppress("DEPRECATION")
            ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.packageName)
        }
        return if (modo == AppOpsManager.MODE_DEFAULT) {
            c.checkCallingOrSelfPermission(Manifest.permission.PACKAGE_USAGE_STATS) == PackageManager.PERMISSION_GRANTED
        } else modo == AppOpsManager.MODE_ALLOWED
    }

    fun sobrepor(c: Context) = Settings.canDrawOverlays(c)

    fun notificacoes(c: Context): Boolean =
        if (Build.VERSION.SDK_INT >= 33) {
            c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        } else c.getSystemService(NotificationManager::class.java).areNotificationsEnabled()

    fun alarmes(c: Context): Boolean =
        Build.VERSION.SDK_INT < 31 || c.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    fun bateria(c: Context): Boolean =
        c.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(c.packageName)

    /** Marcas conhecidas por matar apps em segundo plano: mostramos um passo extra. */
    fun marcaAgressiva(): String? {
        val m = Build.MANUFACTURER.lowercase()
        return listOf("xiaomi", "redmi", "poco", "samsung", "huawei", "honor", "oppo", "vivo", "realme", "oneplus", "motorola", "asus")
            .firstOrNull { m.contains(it) }
    }

    fun estado(c: Context): JSONObject = JSONObject()
        .put(USO, uso(c))
        .put(SOBREPOR, sobrepor(c))
        .put(NOTIFICACOES, notificacoes(c))
        .put(ALARMES, alarmes(c))
        .put(BATERIA, bateria(c))
        .put("marca", Build.MANUFACTURER)
        .put("marcaAgressiva", marcaAgressiva() ?: "")
        .put("android", Build.VERSION.SDK_INT)

    fun essenciaisOk(c: Context) = uso(c) && sobrepor(c)

    /** Abre a tela certa do sistema para liberar a permissão. */
    fun abrir(a: Activity, nome: String) {
        val pkg = Uri.parse("package:${a.packageName}")
        val intent: Intent? = when (nome) {
            USO -> Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
            SOBREPOR -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkg)
            NOTIFICACOES -> {
                val jaPediu = Store.p(a).getBoolean("pediuNotif", false)
                if (Build.VERSION.SDK_INT >= 33 &&
                    (!jaPediu || a.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS))
                ) {
                    Store.p(a).edit().putBoolean("pediuNotif", true).apply()
                    a.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
                    null
                } else {
                    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, a.packageName)
                }
            }
            ALARMES -> if (Build.VERSION.SDK_INT >= 31) {
                Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg)
            } else null
            BATERIA -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            INICIO_AUTO -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg)
            else -> null
        }
        if (intent == null) return
        try {
            a.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            // Algumas marcas escondem essas telas: cai nos detalhes do app.
            a.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg))
        }
    }
}
