// Isla central: hora grande y fecha corta ("16:42 | Sáb 31 oct"). Se usa el
// botón de fecha de GNOME, así el clic sigue abriendo el calendario y las
// notificaciones; solo se cambia lo que muestra.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class Reloj {
    constructor() {
        this._original = Main.panel.statusArea.dateMenu._clockDisplay;

        this._caja = new St.BoxLayout({style_class: 'riel-reloj', y_align: Clutter.ActorAlign.CENTER});
        this._hora = new St.Label({style_class: 'riel-hora', y_align: Clutter.ActorAlign.CENTER});
        this._fecha = new St.Label({style_class: 'riel-fecha', y_align: Clutter.ActorAlign.CENTER});
        this._caja.add_child(this._hora);
        this._caja.add_child(new St.Widget({style_class: 'riel-separador', y_align: Clutter.ActorAlign.CENTER}));
        this._caja.add_child(this._fecha);

        this._original.get_parent().insert_child_above(this._caja, this._original);
        this._original.hide();

        this._ajustes = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._ajustes.connectObject('changed::clock-format', () => this._actualizar(), this);
        // Avisa cada minuto (o cada segundo si GNOME muestra segundos)
        this._reloj = new GnomeDesktop.WallClock();
        this._reloj.connectObject('notify::clock', () => this._actualizar(), this);
        this._actualizar();
    }

    _actualizar() {
        const ahora = GLib.DateTime.new_now_local();
        const formato = this._ajustes.get_string('clock-format') === '12h' ? '%-I:%M %p' : '%H:%M';
        this._hora.text = ahora.format(formato);
        const fecha = ahora.format('%a %-d %b');
        this._fecha.text = fecha.charAt(0).toUpperCase() + fecha.slice(1);
    }

    destroy() {
        this._reloj.disconnectObject(this);
        this._ajustes.disconnectObject(this);
        this._reloj = null;
        this._ajustes = null;
        this._caja.destroy();
        this._original.show();
    }
}
