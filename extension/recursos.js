// Isla derecha: uso de CPU y RAM ("CPU 12%  RAM 4,2 GB"), leídos de /proc
// cada 2 s. Son archivos del kernel en memoria: leerlos no toca el disco.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

const INTERVALO_S = 2;

function leer(ruta) {
    try {
        const [, datos] = GLib.file_get_contents(ruta);
        return new TextDecoder().decode(datos);
    } catch {
        return '';
    }
}

// Tiempo total y ocioso de la CPU desde el arranque (primera línea de /proc/stat)
function tiemposCpu() {
    const valores = leer('/proc/stat').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    const ocioso = (valores[3] ?? 0) + (valores[4] ?? 0); // idle + iowait
    return {total: valores.reduce((a, b) => a + b, 0), ocioso};
}

// RAM en uso: total menos disponible (lo mismo que muestra el Monitor del sistema)
function ramUsadaGb() {
    const texto = leer('/proc/meminfo');
    const valor = clave => Number(new RegExp(`^${clave}:\\s+(\\d+)`, 'm').exec(texto)?.[1] ?? 0);
    return (valor('MemTotal') - valor('MemAvailable')) / 1024 / 1024;
}

export const Recursos = GObject.registerClass(
class Recursos extends St.BoxLayout {
    _init() {
        super._init({style_class: 'riel-recursos', y_align: Clutter.ActorAlign.CENTER});
        this._cpu = new St.Label({style_class: 'riel-recursos-valor', y_align: Clutter.ActorAlign.CENTER});
        this._ram = new St.Label({style_class: 'riel-recursos-valor', y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._cpu);
        this.add_child(this._ram);

        this._anterior = tiemposCpu();
        this._actualizar();
        this._sondeo = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, INTERVALO_S, () => {
            this._actualizar();
            return GLib.SOURCE_CONTINUE;
        });
        this.connect('destroy', () => {
            GLib.source_remove(this._sondeo);
            this._sondeo = 0;
        });
    }

    _actualizar() {
        const ahora = tiemposCpu();
        const total = ahora.total - this._anterior.total;
        const uso = total > 0 ? Math.round(100 * (1 - (ahora.ocioso - this._anterior.ocioso) / total)) : 0;
        this._anterior = ahora;
        this._cpu.text = `CPU ${Math.max(0, Math.min(100, uso))}%`;
        this._ram.text = `RAM ${ramUsadaGb().toFixed(1).replace('.', ',')} GB`;
        this.accessible_name = `${this._cpu.text}, ${this._ram.text}`;
    }
});
