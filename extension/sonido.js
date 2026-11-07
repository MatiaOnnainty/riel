// Sonido del aviso de notificaciones, según los ajustes: uno de los suaves
// que trae Riel, un archivo propio o ninguno, al volumen elegido. Solo usa
// Gio: lo importan la extensión y las preferencias (botón "Probar").
//
// El volumen lo aplica pw-play (PipeWire); si no está, quien llama puede
// pasar otra forma de reproducir (sin volumen).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const SONIDOS = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('sonidos');

export const SONIDOS_PROPIOS = [
    ['suave', 'Suave'],
    ['gota', 'Gota'],
    ['campanita', 'Campanita'],
];

export function archivoDeAviso(ajustes) {
    const modo = ajustes.get_string('sonido');
    if (modo === 'ninguno')
        return null;
    if (modo === 'archivo') {
        const ruta = ajustes.get_string('sonido-archivo');
        const propio = ruta ? Gio.File.new_for_path(ruta) : null;
        if (propio?.query_exists(null))
            return propio;
    }
    const nombre = SONIDOS_PROPIOS.some(([id]) => id === modo) ? modo : 'suave';
    return SONIDOS.get_child(`riel-aviso-${nombre}.wav`);
}

export function reproducirAviso(ajustes, sinVolumen = null) {
    const archivo = archivoDeAviso(ajustes);
    const volumen = ajustes.get_int('volumen-aviso') / 100;
    if (!archivo || volumen <= 0)
        return;
    if (GLib.find_program_in_path('pw-play')) {
        try {
            Gio.Subprocess.new(['pw-play', '--volume', volumen.toFixed(2), archivo.get_path()],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
            return;
        } catch {
            // sigue con la otra forma
        }
    }
    sinVolumen?.(archivo);
}
