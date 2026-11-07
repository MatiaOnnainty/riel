// Página Notificaciones del carrusel: las notificaciones que GNOME guarda
// (las mismas que mostraba el calendario original), en una tarjeta con
// ícono, título, detalle y hace cuánto llegaron. Clic en una la abre;
// "Limpiar" las descarta todas. "No molestar" va del lado opuesto, para
// no limpiar sin querer.
//
// La lista se arma al mostrarse la página; mientras no se ve, solo se anota
// que cambió. Los "Hace 5 min" se actualizan una vez por minuto, y solo con
// la página a la vista.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {Switch} from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Colores apagados para el círculo del ícono; cada app siempre el mismo
const COLORES = 7;

function haceCuanto(fecha) {
    const segundos = GLib.DateTime.new_now_local().difference(fecha) / 1e6;
    const minutos = Math.floor(segundos / 60);
    if (minutos < 1)
        return 'Ahora';
    if (minutos < 60)
        return `Hace ${minutos} min`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24)
        return `Hace ${horas} h`;
    const dias = Math.floor(horas / 24);
    return dias === 1 ? 'Ayer' : `Hace ${dias} días`;
}

// Vista en la lista = ya no es nueva, como en el calendario de GNOME. Las
// críticas no: sus acciones solo están en el aviso emergente
function marcarVista(notificacion) {
    if (notificacion.urgency !== MessageTray.Urgency.CRITICAL)
        notificacion.acknowledged = true;
}

function colorDe(texto) {
    let suma = 0;
    for (const letra of texto ?? '')
        suma = (suma * 31 + letra.charCodeAt(0)) >>> 0;
    return suma % COLORES;
}

const Fila = GObject.registerClass(
class Fila extends St.Button {
    _init(notificacion) {
        super._init({style_class: 'riel-notif-fila', can_focus: true, x_expand: true});
        this.notificacion = notificacion;

        const caja = new St.BoxLayout({style_class: 'riel-notif-caja', x_expand: true});
        const fuente = notificacion.source;
        const circulo = new St.Bin({
            style_class: `riel-notif-icono riel-notif-color-${colorDe(fuente?.title)}`,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                gicon: notificacion.gicon ?? fuente?.icon ?? null,
                fallback_icon_name: 'dialog-information-symbolic',
                style_class: 'riel-notif-icono-imagen',
            }),
        });
        caja.add_child(circulo);

        const textos = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const titulo = new St.Label({text: notificacion.title ?? '', style_class: 'riel-notif-titulo'});
        const cuerpo = new St.Label({style_class: 'riel-notif-cuerpo'});
        // El cuerpo puede traer marcas (<b>, enlaces): se muestra como texto
        cuerpo.text = (notificacion.body ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        cuerpo.visible = !!cuerpo.text;
        for (const etiqueta of [titulo, cuerpo])
            etiqueta.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        textos.add_child(titulo);
        textos.add_child(cuerpo);
        caja.add_child(textos);

        this._tiempo = new St.Label({style_class: 'riel-notif-tiempo', y_align: Clutter.ActorAlign.START});
        caja.add_child(this._tiempo);
        this.set_child(caja);

        this.accessible_name = [titulo.text, cuerpo.text].filter(Boolean).join('. ');
        this.actualizarTiempo();
    }

    actualizarTiempo() {
        this._tiempo.text = haceCuanto(this.notificacion.datetime);
    }
});

export const PaginaNotificaciones = GObject.registerClass(
class PaginaNotificaciones extends St.BoxLayout {
    _init() {
        super._init({style_class: 'riel-pagina riel-notificaciones', vertical: true});
        this.nombre = 'Notificaciones';
        // Ya tiene su título arriba: el carrusel no repite el nombre abajo
        this.conTitulo = true;
        this._visible = false;
        this._minuto = 0;

        const arriba = new St.Widget({layout_manager: new Clutter.BinLayout(), style_class: 'riel-notif-arriba'});
        arriba.add_child(new St.Label({
            text: 'Notificaciones',
            style_class: 'riel-notif-encabezado',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        }));
        this._limpiar = new St.Button({
            style_class: 'riel-notif-limpiar',
            label: 'Limpiar',
            can_focus: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._limpiar.connect('clicked', () => this._limpiarTodo());
        arriba.add_child(this._limpiar);

        // No molestar = GNOME sin avisos emergentes (el mismo ajuste que el
        // interruptor del calendario original)
        this._ajustes = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._interruptor = new Switch(false);
        const noMolestar = new St.Button({
            style_class: 'riel-notif-no-molestar',
            can_focus: true,
            accessible_name: 'No molestar',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        const fila = new St.BoxLayout({style_class: 'riel-notif-no-molestar-caja'});
        fila.add_child(this._interruptor);
        fila.add_child(new St.Label({text: 'No molestar', y_align: Clutter.ActorAlign.CENTER}));
        noMolestar.set_child(fila);
        noMolestar.connect('clicked', () =>
            this._ajustes.set_boolean('show-banners', !this._ajustes.get_boolean('show-banners')));
        const leer = () => {
            this._interruptor.state = !this._ajustes.get_boolean('show-banners');
            noMolestar.checked = this._interruptor.state;
        };
        this._ajustes.connectObject('changed::show-banners', leer, this);
        leer();
        arriba.add_child(noMolestar);
        this.add_child(arriba);

        this._vacio = new St.Label({text: 'Sin notificaciones', style_class: 'riel-notif-vacio', x_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._vacio);

        // Con muchas, la tarjeta se desplaza en lugar de agrandar la isla
        this._lista = new St.BoxLayout({style_class: 'riel-notif-tarjeta', vertical: true});
        this._desplazable = new St.ScrollView({
            style_class: 'riel-notif-desplazable',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: this._lista,
        });
        this.add_child(this._desplazable);

        // Se sigue a cada fuente de notificaciones (una por app)
        const seguir = fuente => fuente.connectObject(
            'notification-added', (_fuente, notificacion) => {
                if (this._visible)
                    marcarVista(notificacion);
                this._cambio();
            },
            'notification-removed', () => this._cambio(), this);
        Main.messageTray.getSources().forEach(seguir);
        Main.messageTray.connectObject(
            'source-added', (_bandeja, fuente) => {
                seguir(fuente);
                this._cambio();
            },
            'source-removed', (_bandeja, fuente) => {
                fuente.disconnectObject(this);
                this._cambio();
            }, this);

        this.connect('destroy', () => {
            this._ajustes.disconnectObject(this);
            this._detenerMinuto();
            Main.messageTray.getSources().forEach(fuente => fuente.disconnectObject(this));
        });
        this._dibujar();
    }

    alMostrar() {
        this._visible = true;
        this._dibujar();
        this._notificaciones().forEach(marcarVista);
        if (!this._minuto) {
            this._minuto = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
                this._lista.get_children().forEach(hijo => hijo.actualizarTiempo?.());
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    alOcultar() {
        this._visible = false;
        this._detenerMinuto();
    }

    _detenerMinuto() {
        if (this._minuto)
            GLib.source_remove(this._minuto);
        this._minuto = 0;
    }

    _cambio() {
        if (this._visible)
            this._dibujar();
    }

    // Las más nuevas arriba
    _notificaciones() {
        return Main.messageTray.getSources().flatMap(fuente => fuente.notifications)
            .sort((a, b) => b.datetime.compare(a.datetime));
    }

    _dibujar() {
        const notificaciones = this._notificaciones();
        this._lista.destroy_all_children();
        notificaciones.forEach((notificacion, i) => {
            if (i > 0)
                this._lista.add_child(new St.Widget({style_class: 'riel-notif-divisor'}));
            const fila = new Fila(notificacion);
            fila.connect('clicked', () => {
                // Abre la app; la notificación se va sola si así lo pide
                Main.panel.closeCalendar();
                notificacion.activate();
            });
            this._lista.add_child(fila);
        });
        const hay = notificaciones.length > 0;
        this._vacio.visible = !hay;
        this._desplazable.visible = hay;
        this._limpiar.visible = hay;
    }

    _limpiarTodo() {
        // Se copian antes: cada destroy() las saca de la lista de su fuente
        this._notificaciones().forEach(n => n.destroy(MessageTray.NotificationDestroyedReason.DISMISSED));
        this._dibujar();
    }
});
