// Página Calendario del carrusel: el mes a la izquierda y la agenda del día
// elegido a la derecha. Los eventos salen del servicio de calendario de GNOME
// (el mismo del reloj original): si no hay calendarios configurados, la
// agenda dice "Sin eventos".

import Clutter from 'gi://Clutter';
import Gettext from 'gettext';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const APP_CALENDARIO = 'org.gnome.Calendar.desktop';
const SEMANAS = 6;

// Inicial de cada día (domingo = 0) con la traducción de GNOME Shell, que en
// español usa X para el miércoles
const NOMBRES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const INICIALES = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const inicial = n => Gettext.domain('gnome-shell').pgettext(`grid ${NOMBRES[n]}`, INICIALES[n]);

// Fechas JS de medianoche, para comparar días
const dia = (anio, mes, d) => new Date(anio, mes, d);
const mismoDia = (a, b) => a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const capital = texto => texto.charAt(0).toUpperCase() + texto.slice(1);
const formato = (fecha, patron) =>
    GLib.DateTime.new_from_unix_local(Math.floor(fecha.getTime() / 1000)).format(patron);

function duracion(evento) {
    const minutos = Math.round((evento.end - evento.date) / 60000);
    if (minutos <= 0)
        return '';
    if (minutos < 60)
        return `${minutos} min`;
    const horas = Math.floor(minutos / 60);
    const resto = minutos % 60;
    return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

export const PaginaCalendario = GObject.registerClass(
class PaginaCalendario extends St.BoxLayout {
    _init() {
        super._init({style_class: 'riel-pagina riel-calendario', vertical: true});
        this.nombre = 'Calendario';

        this._hoy = new Date();
        this._elegido = this._hoy;
        this._mes = dia(this._hoy.getFullYear(), this._hoy.getMonth(), 1);

        this._eventos = new Calendar.DBusEventSource();
        this._eventos.connectObject('changed', () => this._dibujar(), this);

        this.add_child(this._armarEncabezado());
        this.add_child(new St.Widget({style_class: 'riel-divisor riel-divisor-encabezado'}));
        const cuerpo = new St.BoxLayout({style_class: 'riel-calendario-cuerpo'});
        cuerpo.add_child(this._armarMes());
        cuerpo.add_child(new St.Widget({style_class: 'riel-divisor-vertical', y_expand: true}));
        cuerpo.add_child(this._armarAgenda());
        this.add_child(cuerpo);

        this.connect('destroy', () => {
            this.alOcultar();
            this._eventos.destroy();
        });
    }

    // Al mostrarse vuelve al día de hoy y el reloj del encabezado avanza;
    // oculto no consulta nada
    alMostrar() {
        this._hoy = new Date();
        this._elegido = this._hoy;
        this._mes = dia(this._hoy.getFullYear(), this._hoy.getMonth(), 1);
        this._dibujar();
        if (!this._relojPared) {
            this._relojPared = new GnomeDesktop.WallClock();
            this._relojPared.connectObject('notify::clock', () => this._actualizarHora(), this);
        }
        this._actualizarHora();
    }

    alOcultar() {
        this._relojPared?.disconnectObject(this);
        this._relojPared = null;
    }

    _armarEncabezado() {
        const fila = new St.BoxLayout({style_class: 'riel-pagina-encabezado'});
        fila.add_child(new St.Icon({
            icon_name: 'x-office-calendar-symbolic',
            style_class: 'riel-pagina-icono',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        fila.add_child(new St.Label({
            text: 'Calendario',
            style_class: 'riel-pagina-titulo',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        }));
        this._fechaLarga = new St.Label({style_class: 'riel-encabezado-fecha', y_align: Clutter.ActorAlign.CENTER});
        this._hora = new St.Label({style_class: 'riel-encabezado-hora', y_align: Clutter.ActorAlign.CENTER});
        fila.add_child(this._fechaLarga);
        fila.add_child(new St.Widget({style_class: 'riel-separador', y_align: Clutter.ActorAlign.CENTER}));
        fila.add_child(this._hora);
        return fila;
    }

    _actualizarHora() {
        const ahora = GLib.DateTime.new_now_local();
        this._fechaLarga.text = capital(ahora.format('%A, %-d de %B'));
        this._hora.text = ahora.format(Main.panel.statusArea['riel-reloj']?.formatoHora ?? '%H:%M');
    }

    _armarMes() {
        const columna = new St.BoxLayout({style_class: 'riel-mes', vertical: true});

        const navegacion = new St.BoxLayout({style_class: 'riel-mes-navegacion'});
        const flecha = (icono, nombre, paso) => {
            const boton = new St.Button({
                style_class: 'riel-boton-redondo',
                child: new St.Icon({icon_name: icono, style_class: 'riel-boton-icono'}),
                accessible_name: nombre,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            boton.connect('clicked', () => {
                this._mes = dia(this._mes.getFullYear(), this._mes.getMonth() + paso, 1);
                this._dibujar();
            });
            return boton;
        };
        navegacion.add_child(flecha('pan-start-symbolic', 'Mes anterior', -1));
        this._tituloMes = new St.Label({
            style_class: 'riel-mes-titulo',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        navegacion.add_child(this._tituloMes);
        navegacion.add_child(flecha('pan-end-symbolic', 'Mes siguiente', 1));
        const hoy = new St.Button({
            style_class: 'riel-boton-pastilla',
            label: 'Hoy',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        hoy.connect('clicked', () => this.alMostrar());
        navegacion.add_child(hoy);
        columna.add_child(navegacion);

        // Encabezado de días (lunes primero, como el calendario de GNOME en
        // español) y la grilla de 6 semanas
        this._grilla = new St.Widget({
            style_class: 'riel-mes-grilla',
            layout_manager: new Clutter.GridLayout({column_homogeneous: true}),
        });
        const capa = this._grilla.layout_manager;
        this._inicioSemana = Shell.util_get_week_start();
        for (let i = 0; i < 7; i++) {
            capa.attach(new St.Label({
                text: inicial((i + this._inicioSemana) % 7),
                style_class: 'riel-mes-dia-semana',
                x_align: Clutter.ActorAlign.CENTER,
            }), i, 0, 1, 1);
        }
        this._celdas = [];
        for (let s = 0; s < SEMANAS; s++) {
            for (let i = 0; i < 7; i++) {
                // Celda cuadrada y centrada en su columna: hoy es un círculo
                const celda = new St.Button({
                    style_class: 'riel-dia',
                    can_focus: true,
                    x_align: Clutter.ActorAlign.CENTER,
                });
                const caja = new St.Widget({layout_manager: new Clutter.BinLayout()});
                celda._numero = new St.Label({
                    style_class: 'riel-dia-numero',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                    x_expand: true,
                    y_expand: true,
                });
                celda._punto = new St.Widget({
                    style_class: 'riel-dia-punto',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.END,
                    x_expand: true,
                    y_expand: true,
                });
                caja.add_child(celda._numero);
                caja.add_child(celda._punto);
                celda.set_child(caja);
                celda.connect('clicked', () => {
                    this._elegido = celda._fecha;
                    if (celda._fecha.getMonth() !== this._mes.getMonth())
                        this._mes = dia(celda._fecha.getFullYear(), celda._fecha.getMonth(), 1);
                    this._dibujar();
                });
                capa.attach(celda, i, s + 1, 1, 1);
                this._celdas.push(celda);
            }
        }
        columna.add_child(this._grilla);
        return columna;
    }

    _armarAgenda() {
        const columna = new St.BoxLayout({style_class: 'riel-agenda', vertical: true, x_expand: true});
        this._diaSemana = new St.Label({style_class: 'riel-agenda-dia-semana'});
        this._diaLargo = new St.Label({style_class: 'riel-agenda-fecha'});
        this._cantidad = new St.Label({style_class: 'riel-agenda-cantidad'});
        columna.add_child(this._diaSemana);
        columna.add_child(this._diaLargo);
        columna.add_child(this._cantidad);

        this._lista = new St.BoxLayout({style_class: 'riel-agenda-lista', vertical: true, y_expand: true});
        columna.add_child(this._lista);

        // "Añadir evento" y "Abrir Calendario" abren GNOME Calendar; sin la
        // app instalada quedan visibles pero apagados (por ahora no se crean
        // eventos desde Riel)
        const app = Shell.AppSystem.get_default().lookup_app(APP_CALENDARIO);
        const accion = (icono, texto, alClic) => {
            const boton = new St.Button({style_class: 'riel-agenda-accion', can_focus: true, x_expand: true});
            const fila = new St.BoxLayout({x_align: Clutter.ActorAlign.START, x_expand: true});
            fila.add_child(new St.Icon({icon_name: icono, style_class: 'riel-agenda-accion-icono'}));
            fila.add_child(new St.Label({text: texto, y_align: Clutter.ActorAlign.CENTER}));
            boton.set_child(fila);
            boton.reactive = !!app;
            if (!app)
                boton.add_style_pseudo_class('insensitive');
            boton.connect('clicked', alClic);
            return boton;
        };
        const abrir = () => {
            Main.panel.closeCalendar();
            app?.activate();
        };
        columna.add_child(new St.Widget({style_class: 'riel-divisor'}));
        columna.add_child(accion('list-add-symbolic', 'Añadir evento', abrir));
        columna.add_child(new St.Widget({style_class: 'riel-divisor'}));
        columna.add_child(accion('external-link-symbolic', 'Abrir Calendario', abrir));
        return columna;
    }

    _dibujar() {
        const anio = this._mes.getFullYear();
        const mes = this._mes.getMonth();
        this._tituloMes.text = capital(formato(this._mes, '%B %Y'));

        // Primer día de la grilla: el inicio de la semana del día 1
        const corrimiento = (this._mes.getDay() - this._inicioSemana + 7) % 7;
        const inicio = dia(anio, mes, 1 - corrimiento);
        const fin = dia(anio, mes, 1 - corrimiento + SEMANAS * 7);
        this._eventos.requestRange(inicio, fin);

        this._celdas.forEach((celda, i) => {
            const fecha = dia(anio, mes, 1 - corrimiento + i);
            celda._fecha = fecha;
            celda._numero.text = `${fecha.getDate()}`;
            celda._punto.opacity = this._eventos.hasEvents(fecha) ? 255 : 0;
            const marcar = (clase, si) => (si ? celda.add_style_pseudo_class(clase) : celda.remove_style_pseudo_class(clase));
            marcar('otro-mes', fecha.getMonth() !== mes);
            marcar('hoy', mismoDia(fecha, this._hoy));
            marcar('elegido', mismoDia(fecha, this._elegido) && !mismoDia(fecha, this._hoy));
            celda.accessible_name = formato(fecha, '%A %-d de %B');
        });
        this._dibujarAgenda();
    }

    _dibujarAgenda() {
        const d = this._elegido;
        this._diaSemana.text = formato(d, '%A').toUpperCase();
        this._diaLargo.text = formato(d, '%-d de %B');

        const desde = dia(d.getFullYear(), d.getMonth(), d.getDate());
        const hasta = dia(d.getFullYear(), d.getMonth(), d.getDate() + 1);
        const eventos = this._eventos.getEvents(desde, hasta);
        this._cantidad.text = eventos.length === 1 ? '1 evento'
            : eventos.length ? `${eventos.length} eventos` : 'Sin eventos';

        this._lista.destroy_all_children();
        eventos.forEach((evento, i) => {
            const fila = new St.BoxLayout({style_class: 'riel-evento'});
            fila.add_child(new St.Widget({style_class: `riel-evento-barra riel-evento-color-${i % 2}`}));
            const todoElDia = evento.date <= desde && evento.end >= hasta;
            fila.add_child(new St.Label({
                text: todoElDia ? 'Todo el día' : formato(evento.date, '%H:%M'),
                style_class: 'riel-evento-hora',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            fila.add_child(new St.Widget({style_class: 'riel-separador', y_align: Clutter.ActorAlign.CENTER}));
            const texto = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            texto.add_child(new St.Label({text: evento.summary, style_class: 'riel-evento-titulo'}));
            if (!todoElDia)
                texto.add_child(new St.Label({text: duracion(evento), style_class: 'riel-evento-duracion'}));
            fila.add_child(texto);
            this._lista.add_child(fila);
        });
    }
});
