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
# abren una ventana propia) + Riel
extensiones="['ubuntu-dock@ubuntu.com', 'tiling-assistant@ubuntu.com'${riel:+, $riel}]"

export XDG_CONFIG_HOME="$dev/config" XDG_DATA_HOME="$dev/data" \
       XDG_CACHE_HOME="$dev/cache" XDG_STATE_HOME="$dev/state" \
       MUTTER_DEBUG_DUMMY_MODE_SPECS="$resolucion" \
       SHELL_DEBUG=backtrace-warnings \
       RIEL_FAVORITAS="$favoritas" RIEL_GTK="$gtk_tema" RIEL_ICONOS="$iconos" \
       RIEL_ESQUEMA="$esquema" RIEL_EXTENSIONES="$extensiones"

echo "Shell de pruebas a $resolucion. Cerrá la ventana para terminar."
exec dbus-run-session -- bash -c '
  poner() { [[ -n "$3" ]] && gsettings set "$1" "$2" "$3" 2>/dev/null || true; }
  poner org.gnome.shell favorite-apps "$RIEL_FAVORITAS"
  poner org.gnome.desktop.interface gtk-theme "$RIEL_GTK"
  poner org.gnome.desktop.interface icon-theme "$RIEL_ICONOS"
  poner org.gnome.desktop.interface color-scheme "$RIEL_ESQUEMA"
  poner org.gnome.shell enabled-extensions "$RIEL_EXTENSIONES"
  poner org.gnome.shell disable-user-extensions false
  exec gnome-shell --nested --wayland
'
