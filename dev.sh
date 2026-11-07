#!/usr/bin/env bash
# Abre un GNOME Shell de pruebas en una ventana (sesión anidada), aislado de
# tu sesión real:
#   - su propio bus D-Bus (dbus-run-session): no choca con tu GNOME Shell;
#   - su propia configuración (dconf) y carpeta de extensiones en .dev/:
#     activar Riel acá no la activa en tu escritorio.
# Ves tus apps, íconos y fuentes (enlazados desde ~/.local/share) y se copian
# tus fijadas y tu tema, para que se vea como tu escritorio.
#
# Uso: ./dev.sh          (cerrá la ventana para terminar; volvé a correrlo
#                         para probar cambios: en Wayland no hay recarga en caliente)
#      ./dev.sh --limpio (borra .dev/ y arranca de cero)
# Los errores de la extensión aparecen en esta terminal como "JS ERROR".
set -euo pipefail

# La terminal de VS Code (snap) cambia variables como GSETTINGS_SCHEMA_DIR o
# XDG_DATA_DIRS para apuntar a sus propias bibliotecas, y el Shell se cae al
# leer esquemas viejos. Se restauran los valores originales que guarda el snap.
while IFS='=' read -r var _; do
  orig="${var%_VSCODE_SNAP_ORIG}"
  if [[ -n "${!var}" ]]; then export "$orig=${!var}"; else unset "$orig"; fi
done < <(env | grep -o '^[A-Z_]*_VSCODE_SNAP_ORIG=')
unset GIO_LAUNCHED_DESKTOP_FILE GIO_LAUNCHED_DESKTOP_FILE_PID

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Desde la terminal de VS Code (snap), todo lo que se lanza hereda su
# etiqueta de seguridad (snap.code.code) y GNOME asigna cada ventana de prueba
# a VS Code: las apps parecen no abrir y el cursor queda cargando. En ese caso
# dev.sh se vuelve a abrir solo en GNOME Terminal, que no tiene esa etiqueta.
# RIEL_REEJECUTADO evita un bucle si la pestaña nueva también fuera de un snap.
if [[ "$(cat /proc/self/attr/current 2>/dev/null)" == snap.* && -z "${RIEL_REEJECUTADO:-}" ]]; then
  export RIEL_REEJECUTADO=1
  echo "Esta terminal es de un snap (VS Code): abro el Shell de pruebas desde GNOME Terminal."
  # La pestaña queda abierta al terminar, para poder leer los JS ERROR
  exec gnome-terminal --title="Riel · Shell de pruebas" -- \
    bash -c '"$@"; echo; read -rp "Enter para cerrar…"' _ "$repo/dev.sh" "$@"
fi

uuid="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["uuid"])' "$repo/extension/metadata.json")"
dev="$repo/.dev"
resolucion="${RIEL_RESOLUCION:-1366x768}"

[[ "${1:-}" == "--limpio" ]] && rm -rf "$dev"
mkdir -p "$dev/config" "$dev/cache" "$dev/state" "$dev/data/gnome-shell/extensions"

# Datos que sí se comparten con tu usuario (solo lectura en la práctica)
for d in applications icons fonts; do
  [[ -e "$HOME/.local/share/$d" && ! -e "$dev/data/$d" ]] && ln -s "$HOME/.local/share/$d" "$dev/data/$d"
done
# Carpetas personales en español (Escritorio, Descargas…): sin esto, los
# íconos del escritorio de Ubuntu buscan ~/Desktop y se reinician sin parar
for f in user-dirs.dirs user-dirs.locale; do
  [[ -e "$HOME/.config/$f" && ! -e "$dev/config/$f" ]] && ln -s "$HOME/.config/$f" "$dev/config/$f"
done

# Sin llavero en la sesión de pruebas: el de GNOME detecta el de tu escritorio
# real y no responde en este bus, y los portales esperan ~25 s hasta rendirse
# (las apps tardan eso en abrir o no abren). Este servicio falla al instante y,
# de paso, las apps de prueba no tocan tus contraseñas.
mkdir -p "$dev/data/dbus-1/services"
printf '[D-BUS Service]\nName=org.freedesktop.secrets\nExec=/bin/false\n' \
  > "$dev/data/dbus-1/services/org.freedesktop.secrets.service"

# Sin métodos de entrada en la sesión de pruebas: GNOME lanza "ibus-daemon"
# buscándolo en el PATH, y el de una sesión aislada llegó a ocupar 6,4 GB y
# el sistema cerró VS Code por falta de memoria. Este falso termina al
# instante; la distribución del teclado sigue andando sin ibus.
mkdir -p "$dev/bin"
printf '#!/bin/sh\nexit 0\n' > "$dev/bin/ibus-daemon"
chmod +x "$dev/bin/ibus-daemon"

# Riel: enlazada solo cuando ya tiene código
enlace="$dev/data/gnome-shell/extensions/$uuid"
rm -f "$enlace"
if [[ -f "$repo/extension/extension.js" ]]; then
  ln -s "$repo/extension" "$enlace"
  riel="'$uuid'"
else
  echo "Todavía no hay extension/extension.js: abro el Shell sin Riel."
  riel=""
fi

# Valores de tu sesión real que se copian a la de pruebas (se leen antes de aislar)
leer() { gsettings get "$1" "$2" 2>/dev/null || true; }
favoritas="$(leer org.gnome.shell favorite-apps)"
gtk_tema="$(leer org.gnome.desktop.interface gtk-theme)"
iconos="$(leer org.gnome.desktop.interface icon-theme)"
esquema="$(leer org.gnome.desktop.interface color-scheme)"

# Extensiones del sistema que trae Ubuntu (sin los íconos del escritorio, que
# abren una ventana propia), los íconos de bandeja (AppIndicator: Toolbox,
# Netbird…) + Riel
extensiones="['ubuntu-dock@ubuntu.com', 'tiling-assistant@ubuntu.com', 'ubuntu-appindicators@ubuntu.com'${riel:+, $riel}]"

# La pantalla de pruebas lleva el número de proceso: dos sesiones a la vez
# (por ejemplo, la tuya y una prueba automática) no chocan
export PATH="$dev/bin:$PATH" \
       XDG_CONFIG_HOME="$dev/config" XDG_DATA_HOME="$dev/data" \
       XDG_CACHE_HOME="$dev/cache" XDG_STATE_HOME="$dev/state" \
       MUTTER_DEBUG_DUMMY_MODE_SPECS="$resolucion" \
       SHELL_DEBUG=backtrace-warnings \
       RIEL_FAVORITAS="$favoritas" RIEL_GTK="$gtk_tema" RIEL_ICONOS="$iconos" \
       RIEL_ESQUEMA="$esquema" RIEL_EXTENSIONES="$extensiones" \
       RIEL_WAYLAND="wayland-riel-$$"

echo "Shell de pruebas a $resolucion. Cerrá la ventana para terminar."
exec dbus-run-session -- bash -c '
  poner() { [[ -n "$3" ]] && gsettings set "$1" "$2" "$3" 2>/dev/null || true; }
  poner org.gnome.shell favorite-apps "$RIEL_FAVORITAS"
  poner org.gnome.desktop.interface gtk-theme "$RIEL_GTK"
  poner org.gnome.desktop.interface icon-theme "$RIEL_ICONOS"
  poner org.gnome.desktop.interface color-scheme "$RIEL_ESQUEMA"
  poner org.gnome.shell enabled-extensions "$RIEL_EXTENSIONES"
  poner org.gnome.shell disable-user-extensions false
  # Archivos, Terminal y otras apps arrancan por D-Bus y toman el entorno de
  # este bus. Sin esto heredan WAYLAND_DISPLAY=wayland-0 (tu escritorio real)
  # y se abren afuera. Las apps solo X11 no abren acá (DISPLAY vacío).
  dbus-update-activation-environment WAYLAND_DISPLAY="$RIEL_WAYLAND" DISPLAY=
  exec gnome-shell --nested --wayland --wayland-display "$RIEL_WAYLAND"
'
