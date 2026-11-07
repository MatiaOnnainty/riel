// Isla derecha: uso de CPU y RAM, leídos de /proc cada 2 s (son archivos
// del kernel en memoria: leerlos no toca el disco). Con el ajuste
// recursos-modo en «texto» se ve "CPU 12%  RAM 4,2 GB"; en «icono», un ícono
// en lugar de la palabra y "4,2" sin "GB", para pantallas chicas.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

const INTERVALO_S = 2;
const ICONOS = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('iconos');
const icono = nombre => new Gio.FileIcon({file: ICONOS.get_child(`riel-${nombre}-symbolic.svg`)});

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
    _init(ajustes) {
        super._init({style_class: 'riel-recursos', y_align: Clutter.ActorAlign.CENTER});
        const par = nombre => {
            const caja = new St.BoxLayout({style_class: 'riel-recursos-par', y_align: Clutter.ActorAlign.CENTER});
            const imagen = new St.Icon({gicon: icono(nombre), style_class: 'riel-recursos-icono', y_align: Clutter.ActorAlign.CENTER});
            const valor = new St.Label({style_class: 'riel-recursos-valor', y_align: Clutter.ActorAlign.CENTER});
            caja.add_child(imagen);
            caja.add_child(valor);
            this.add_child(caja);
            return {imagen, valor};
        };
        this._parCpu = par('cpu');
        this._parRam = par('ram');
        this._cpu = this._parCpu.valor;
        this._ram = this._parRam.valor;

        this._ajustes = ajustes;
        ajustes.connectObject('changed::recursos-modo', () => this._actualizar(false), this);

        this._anterior = tiemposCpu();
        this._actualizar();
        this._sondeo = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, INTERVALO_S, () => {
            this._actualizar();
            return GLib.SOURCE_CONTINUE;
        });
        this.connect('destroy', () => {
            GLib.source_remove(this._sondeo);
            this._sondeo = 0;
            this._ajustes.disconnectObject(this);
        });
    }

    // medir: false solo redibuja (al cambiar el modo), sin tomar otra muestra
    _actualizar(medir = true) {
        if (medir) {
            const ahora = tiemposCpu();
            const total = ahora.total - this._anterior.total;
            const uso = total > 0 ? Math.round(100 * (1 - (ahora.ocioso - this._anterior.ocioso) / total)) : 0;
            this._anterior = ahora;
            this._uso = Math.max(0, Math.min(100, uso));
            this._gb = ramUsadaGb().toFixed(1).replace('.', ',');
        }
        const conIconos = this._ajustes.get_string('recursos-modo') === 'icono';
        this._parCpu.imagen.visible = this._parRam.imagen.visible = conIconos;
        this._cpu.text = conIconos ? `${this._uso}%` : `CPU ${this._uso}%`;
        this._ram.text = conIconos ? this._gb : `RAM ${this._gb} GB`;
        this.accessible_name = `CPU ${this._uso}%, RAM ${this._gb} GB`;
    }
});
