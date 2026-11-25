# Zoe Foco · app Android (v0.1)

O MVP do [conceito](../CONCEITO.md): hábitos, horários de foco, apps vigiados e o peteleco em 3 níveis.

- **Leve**: o APK final tem cerca de 60 KB. Usa só Kotlin e o WebView do sistema, sem bibliotecas extras.
- **Privado**: o app **não tem permissão de internet**. Hábitos e uso dos apps ficam só no celular.
- **Android 8.0 ou mais novo** (minSdk 26).

## Como instalar no celular

1. Baixe o `app-release.apk` (ou gere com o comando abaixo).
2. No celular, abra o arquivo e permita "instalar apps desta fonte" quando o Android pedir.
3. Abra a Zoe Foco e siga as boas-vindas.

O APK de teste é assinado com a chave de debug. Antes de publicar na Play Store, criar uma chave própria.

## Como gerar o APK

Precisa do JDK 17+ e do Android SDK (platform 36, build-tools 36).

```bash
cd app/android
echo "sdk.dir=/caminho/do/android-sdk" > local.properties
./gradlew assembleRelease
```

O APK sai em `app/build/outputs/apk/release/app-release.apk`.

## Permissões

| Nível | Permissão | Para quê | Onde se libera |
| --- | --- | --- | --- |
| Essencial | Acesso aos dados de uso (`PACKAGE_USAGE_STATS`) | Saber qual app foi aberto durante o foco | Configurações › Acesso ao uso |
| Essencial | Sobrepor a outros apps (`SYSTEM_ALERT_WINDOW`) | Aparecer por cima do app e dar o peteleco | Configurações › Sobreposição |
| Recomendada | Notificações (`POST_NOTIFICATIONS`, Android 13+) | Avisar que o foco começou e mostrar "Zoe de guarda" | Pedido direto do app |
| Recomendada | Alarmes exatos (`SCHEDULE_EXACT_ALARM`, Android 12+) | Começar a vigiar na hora certa e poder iniciar o vigia em segundo plano | Configurações › Alarmes e lembretes |
| Recomendada | Sem otimização de bateria | Evitar que o sistema mate o vigia no meio do foco | Configurações › Bateria |
| Automática | Serviço em primeiro plano, iniciar com o celular, vibrar | Manter o vigia rodando, reagendar depois de reiniciar, vibrar no peteleco | Não pede nada ao usuário |
| Futura | Acessibilidade | Bloquear só Reels e Shorts | Não pedimos: a Play Store não aceita esse uso |

Em celulares Xiaomi, Samsung, Huawei, Oppo, Vivo, Realme, OnePlus, Motorola e Asus, a tela de permissões mostra um passo extra ("início automático").

## Como funciona

```
AlarmManager ──(início/fim de cada foco)──▶ Guard.sincronizar
                                              │
                                              ▼
                               FocusGuardService (só durante o foco)
                               a cada 1 s: UsageStatsManager.queryEvents
                                              │ abriu um app vigiado?
                                              ▼
                               PetelecoActivity (por cima do app)
                               1ª cutucada · 2ª peteleco · 3ª+ bloqueio
                               "Tá bom" → tela inicial · emergência → 5 min livres
```

| Arquivo | O que faz |
| --- | --- |
| `Store.kt` | Tudo que fica salvo: hábitos, energia, horários, vigiados, tentativas |
| `Perms.kt` | Checa e abre cada permissão |
| `Guard.kt` | Agenda alarmes, liga o vigia, notificações |
| `FocusGuardService.kt` | O vigia que detecta o app aberto |
| `PetelecoActivity.kt` | A tela por cima, com vibração e voz (TextToSpeech, offline) |
| `MainActivity.kt` | Hospeda a interface e a ponte `window.Zoe` |
| `assets/www/` | Interface em HTML/CSS/JS, com o mesmo orbe do portfólio |

Para ver a interface no navegador do computador, abra `assets/www/index.html` (usa dados de exemplo; `index.html#novo` mostra as boas-vindas).
