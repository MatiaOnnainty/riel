// Isla central. Compacta, resume el panel activo (el último en el que se
// cerró la isla): Calendario → hora y fecha ("16:42 | Sáb 31 oct"); Música →
// carátula y "título · artista"; Notificaciones → hora, fecha y una campana
// sólida si hay sin leer. El clic la expande con el carrusel (Música,
// Notificaciones, Calendario).
//
// Avisos: cuando GNOME va a mostrar una notificación, la isla compacta la
// muestra en su lugar (ícono de la app, quién y parte del mensaje) con un
// sonido suave, 4 s, y vuelve a su resumen. El cursor encima la pausa y un
// clic la abre. Las críticas siguen con el aviso de GNOME (tienen botones),
// y No molestar, pantalla completa, etc. se respetan porque decide GNOME.
//
// Es un botón del panel con su propio menú, así GNOME se encarga de cerrarlo
// con un clic afuera o Esc, y de que haya un solo menú del panel abierto a
// la vez (abrir el carrusel cierra el menú del sistema y viceversa). El
// botón de fecha de GNOME queda oculto mientras Riel está activa.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {PaginaCalendario} from './calendario.js';
import {Carrusel} from './carrusel.js';
import {PaginaMusica} from './musica.js';
import {PaginaNotificaciones} from './notificaciones.js';
import {IslaExpandida} from './islaExpandida.js';

// Íconos y sonido propios (la campana sólida no existe en el tema del
// sistema; el aviso es suave a propósito)
const CARPETA = Gio.File.new_for_uri(import.meta.url).get_parent();
const ICONOS = CARPETA.get_child('iconos');
const SONIDO_AVISO = CARPETA.get_child('sonidos').get_child('riel-aviso.wav');
const DURACION_AVISO_MS = 4000;
const icono = nombre => new Gio.FileIcon({file: ICONOS.get_child(`${nombre}-symbolic.svg`)});


export const Reloj = GObject.registerClass(
class Reloj extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Reloj');
        this.add_style_class_name('riel-reloj-boton');

        const caja = new St.BoxLayout({style_class: 'riel-reloj', y_align: Clutter.ActorAlign.CENTER});
        // Hora y fecha
        this._horaFecha = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER});
        this._hora = new St.Label({style_class: 'riel-hora', y_align: Clutter.ActorAlign.CENTER});
        this._fecha = new St.Label({style_class: 'riel-fecha', y_align: Clutter.ActorAlign.CENTER});
        this._horaFecha.add_child(this._hora);
        this._horaFecha.add_child(new St.Widget({style_class: 'riel-separador', y_align: Clutter.ActorAlign.CENTER}));
        this._horaFecha.add_child(this._fecha);
        caja.add_child(this._horaFecha);
        // Lo que suena
        this._musica = new St.BoxLayout({style_class: 'riel-compacta-musica', y_align: Clutter.ActorAlign.CENTER});
        this._caratula = new St.Icon({style_class: 'riel-compacta-caratula', y_align: Clutter.ActorAlign.CENTER});
        this._cancion = new St.Label({style_class: 'riel-compacta-cancion', y_align: Clutter.ActorAlign.CENTER});
        this._cancion.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._musica.add_child(this._caratula);
        this._musica.add_child(this._cancion);
        caja.add_child(this._musica);
        // Notificaciones sin leer
        this._campana = new St.Icon({style_class: 'riel-compacta-campana', y_align: Clutter.ActorAlign.CENTER});
        caja.add_child(this._campana);
        // Aviso de una notificación que llega
        this._aviso = new St.BoxLayout({style_class: 'riel-compacta-aviso', visible: false, y_align: Clutter.ActorAlign.CENTER});
        this._avisoIcono = new St.Icon({style_class: 'riel-compacta-aviso-icono', y_align: Clutter.ActorAlign.CENTER});
        this._avisoTitulo = new St.Label({style_class: 'riel-compacta-aviso-titulo', y_align: Clutter.ActorAlign.CENTER});
        this._avisoCuerpo = new St.Label({style_class: 'riel-compacta-aviso-cuerpo', y_align: Clutter.ActorAlign.CENTER});
        for (const etiqueta of [this._avisoTitulo, this._avisoCuerpo])
            etiqueta.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._aviso.add_child(this._avisoIcono);
        this._aviso.add_child(this._avisoTitulo);
        this._aviso.add_child(this._avisoCuerpo);
        caja.add_child(this._aviso);
        this._caja = caja;
        this.add_child(caja);

        // La isla expandida: el menú crece desde el borde de arriba y tapa la
        // isla del reloj (su encabezado repite fecha y hora)
        this._carrusel = new Carrusel([new PaginaMusica(), new PaginaNotificaciones(), new PaginaCalendario()]);
        this.menu.box.add_child(this._carrusel);
        this._carrusel.connectObject('activa-cambio', () => this._compactar(), this);
        this._carrusel._paginas.filter(pagina => pagina.resumen).forEach(pagina =>
            pagina.connectObject('resumen-cambio', () => this._compactar(), this));
        this._isla = new IslaExpandida(this.menu, {
            caja: Main.panel._centerBox,
            contenido: this._carrusel,
            // Clic sobre un aviso: abre esa notificación en vez del carrusel
            alAlternar: () => {
                if (!this._avisoActual || this.menu.isOpen)
                    return false;
                const notificacion = this._avisoActual;
                this._terminarAviso();
                notificacion.activate();
                return true;
            },
        });
        this.menu.connectObject('open-state-changed', (_menu, abierto) => {
            if (abierto)
                this._carrusel.alAbrir();
            else
                this._carrusel.alCerrar();
        }, this);

        this._ajustes = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._ajustes.connectObject('changed::clock-format', () => this._actualizar(), this);
        // Avisa cada minuto (o cada segundo si GNOME muestra segundos)
        this._reloj = new GnomeDesktop.WallClock();
        this._reloj.connectObject('notify::clock', () => this._actualizar(), this);
        this._actualizar();
        this._compactar();
        this._engancharAvisos();
    }

    // GNOME decide cuándo toca mostrar una notificación (con sus reglas de
    // No molestar, pantalla completa, ocupado…) y llama a _showNotification.
    // Ahí se toma la próxima de su cola, salvo las críticas, que siguen con
    // el aviso de GNOME
    _engancharAvisos() {
        this._avisos = [];
        this._avisoActual = null;
        this._tiempoAviso = 0;
        this._seguirCola = 0;
        const bandeja = Main.messageTray;
        const original = bandeja._showNotification;
        // La decisión se toma un ciclo después de que GNOME la pide: GNOME
        // puede avisar mientras todavía está cargando los datos de la
        // notificación (medido: llega como normal y recién después pasa a
        // crítica). En ese ciclo se vuelve a pedir el estado a GNOME y, con
        // los datos completos, la isla la toma o se la deja
        let decidir = false;
        bandeja._showNotification = () => {
            const notificacion = bandeja._notificationQueue[0];
            if (!notificacion || notificacion.urgency === MessageTray.Urgency.CRITICAL) {
                original.call(bandeja);
                return;
            }
            if (!decidir) {
                this._reintentarCola(() => (decidir = true), () => (decidir = false));
                return;
            }
            bandeja._notificationQueue.shift();
            bandeja.emit('queue-changed');
            // Mostrada, como cuando GNOME muestra su aviso
            notificacion.acknowledged = true;
            this._encolarAviso(notificacion);
            // Puede haber más en la cola: GNOME sigue en el próximo ciclo
            this._reintentarCola();
        };
        this.connect('notify::hover', () => this._programarFinAviso());
    }

    // Le pide a GNOME que revise su cola en el próximo ciclo (ahora está en
    // medio de su cálculo); antes y después, lo que haga falta
    _reintentarCola(antes = () => {}, despues = () => {}) {
        if (this._seguirCola)
            return;
        this._seguirCola = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._seguirCola = 0;
            antes();
            Main.messageTray._updateState();
            despues();
            return GLib.SOURCE_REMOVE;
        });
    }

    _soltarAvisos() {
        delete Main.messageTray._showNotification;
        if (this._seguirCola)
            GLib.source_remove(this._seguirCola);
        if (this._tiempoAviso)
            GLib.source_remove(this._tiempoAviso);
        this._seguirCola = this._tiempoAviso = 0;
        this._avisos.forEach(n => n.disconnectObject(this));
        this._avisos = [];
        this._avisoActual?.disconnectObject(this);
        this._avisoActual = null;
    }

    // Se vigila desde que entra a la cola: si la descartan (o la app la
    // retira) antes de mostrarse, sale sin mostrarse ni sonar; si se está
    // viendo, se pasa a la próxima
    _encolarAviso(notificacion) {
        notificacion.connectObject('destroy', () => {
            notificacion.disconnectObject(this);
            if (notificacion === this._avisoActual)
                this._terminarAviso();
            else
                this._avisos = this._avisos.filter(n => n !== notificacion);
        }, this);
        this._avisos.push(notificacion);
        if (!this._avisoActual)
            this._siguienteAviso();
    }

    // De a uno: cada aviso dura lo suyo y después viene el próximo
    _siguienteAviso() {
        this._avisoActual?.disconnectObject(this);
        this._avisoActual = this._avisos.shift() ?? null;
        const n = this._avisoActual;
        if (!n) {
            this._aviso.visible = false;
            this._compactar();
            this._aparecer();
            return;
        }

        this._avisoIcono.gicon = n.source?.icon ?? n.gicon ?? new Gio.ThemedIcon({name: 'dialog-information-symbolic'});
        this._avisoTitulo.text = n.title ?? '';
        this._avisoCuerpo.text = (n.body ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        this._avisoCuerpo.visible = !!this._avisoCuerpo.text;
        this.accessible_name = [n.title, this._avisoCuerpo.text].filter(Boolean).join(': ');
        this._horaFecha.visible = this._musica.visible = this._campana.visible = false;
        this._aviso.visible = true;
        this._aparecer();
        global.display.get_sound_player().play_from_file(SONIDO_AVISO, 'Notificación', null);
        this._programarFinAviso();
    }

    // 4 s desde que llega, o desde que el cursor se va de encima
    _programarFinAviso() {
        if (this._tiempoAviso)
            GLib.source_remove(this._tiempoAviso);
        this._tiempoAviso = 0;
        if (!this._avisoActual || this.hover)
            return;
        this._tiempoAviso = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DURACION_AVISO_MS, () => {
            this._tiempoAviso = 0;
            this._terminarAviso();
            return GLib.SOURCE_REMOVE;
        });
    }

    _terminarAviso() {
        if (this._tiempoAviso)
            GLib.source_remove(this._tiempoAviso);
        this._tiempoAviso = 0;
        this._siguienteAviso();
    }

    // Cambio suave del contenido de la isla compacta
    _aparecer() {
        this._caja.remove_all_transitions();
        this._caja.opacity = 0;
        this._caja.ease({opacity: 255, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    // La isla compacta según el resumen del panel activo
    _compactar() {
        // Mientras se ve un aviso, el resumen espera a que termine
        if (this._avisoActual)
            return;
        const resumen = this._carrusel.paginaActiva.resumen?.() ?? null;
        const musica = !!resumen?.texto;
        this._musica.visible = musica;
        this._horaFecha.visible = !musica;
        if (musica) {
            this._caratula.gicon = resumen.gicon;
            this._cancion.text = resumen.texto;
            this.accessible_name = `Sonando: ${resumen.texto}`;
        } else {
            this.accessible_name = 'Reloj';
        }
        this._campana.visible = !!resumen?.campana;
        if (resumen?.campana) {
            this._campana.gicon = icono(resumen.sinLeer ? 'riel-campana-llena' : 'riel-campana-vacia');
            this._campana.accessible_name = resumen.sinLeer ? 'Hay notificaciones sin leer' : 'Sin notificaciones nuevas';
        }
    }

    // Formato de hora según GNOME (24 o 12 horas); también lo usa el
    // encabezado de las páginas
    get formatoHora() {
        return this._ajustes.get_string('clock-format') === '12h' ? '%-I:%M %p' : '%H:%M';
    }

    _actualizar() {
        const ahora = GLib.DateTime.new_now_local();
        this._hora.text = ahora.format(this.formatoHora);
        const fecha = ahora.format('%a %-d %b');
        this._fecha.text = fecha.charAt(0).toUpperCase() + fecha.slice(1);
    }

    destroy() {
        this._soltarAvisos();
        this._reloj.disconnectObject(this);
        this._ajustes.disconnectObject(this);
        this._reloj = null;
        this._ajustes = null;
        this._isla.destroy();
        super.destroy();
    }
});
