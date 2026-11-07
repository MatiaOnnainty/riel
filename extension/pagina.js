// Encabezado común de las páginas del carrusel: ícono y nombre de la página
// a la izquierda, fecha larga y hora a la derecha. Ocupa el lugar de la isla
// del reloj cuando la isla crece, así la hora sigue a la vista.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const capital = texto => texto.charAt(0).toUpperCase() + texto.slice(1);

export class Encabezado {
    constructor(icono, titulo) {
        this.actor = new St.BoxLayout({vertical: true});
        const fila = new St.BoxLayout({style_class: 'riel-pagina-encabezado'});
        fila.add_child(new St.Icon({
            icon_name: icono,
            style_class: 'riel-pagina-icono',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        fila.add_child(new St.Label({
            text: titulo,
            style_class: 'riel-pagina-titulo',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        }));
        this._fecha = new St.Label({style_class: 'riel-encabezado-fecha', y_align: Clutter.ActorAlign.CENTER});
        this._hora = new St.Label({style_class: 'riel-encabezado-hora', y_align: Clutter.ActorAlign.CENTER});
        fila.add_child(this._fecha);
        fila.add_child(new St.Widget({style_class: 'riel-separador', y_align: Clutter.ActorAlign.CENTER}));
        fila.add_child(this._hora);
        this.actor.add_child(fila);
        this.actor.add_child(new St.Widget({style_class: 'riel-divisor riel-divisor-encabezado'}));
        this.actor.connect('destroy', () => this.detener());
    }

    // El reloj solo corre mientras la página se ve
    arrancar() {
        if (!this._reloj) {
            this._reloj = new GnomeDesktop.WallClock();
            this._reloj.connectObject('notify::clock', () => this._actualizar(), this);
        }
        this._actualizar();
    }

    detener() {
        this._reloj?.disconnectObject(this);
        this._reloj = null;
    }

    _actualizar() {
        const ahora = GLib.DateTime.new_now_local();
        this._fecha.text = capital(ahora.format('%A, %-d de %B'));
        this._hora.text = ahora.format(Main.panel.statusArea['riel-reloj']?.formatoHora ?? '%H:%M');
    }
}
