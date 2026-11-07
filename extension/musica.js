// Página Música del carrusel: el reproductor que sonó último, con carátula,
// título, barra de progreso, controles y el volumen de esa app en el
// mezclador. Con varios reproductores, ‹ › cambia de uno a otro.
//
// La posición de la canción se consulta una vez por segundo, y solo
// mientras la página se ve y algo suena.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

import {Reproductores} from './mpris.js';
import {Encabezado} from './pagina.js';

const TAMANO_CARATULA = 112;

function tiempo(segundos) {
    const s = Math.max(0, Math.floor(segundos));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function boton(icono, nombre, clase = 'riel-boton-redondo') {
    return new St.Button({
        style_class: clase,
        child: new St.Icon({icon_name: icono, style_class: 'riel-boton-icono'}),
        accessible_name: nombre,
        can_focus: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

export const PaginaMusica = GObject.registerClass(
class PaginaMusica extends St.BoxLayout {
    _init() {
        super._init({style_class: 'riel-pagina riel-musica', vertical: true});
        this.nombre = 'Música';
        this._visible = false;
        // El reproductor elegido se recuerda por su nombre en el bus: la
        // lista se reordena cada vez que alguno empieza a sonar
        this._elegido = null;
        this._arrastrando = false;
        this._sondeo = 0;

        this._encabezado = new Encabezado('audio-x-generic-symbolic', 'Música');
        this.add_child(this._encabezado.actor);

        this._vacio = new St.BoxLayout({
            style_class: 'riel-musica-vacio',
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        });
        this._vacio.add_child(new St.Icon({icon_name: 'audio-x-generic-symbolic', style_class: 'riel-musica-vacio-icono'}));
        this._vacio.add_child(new St.Label({text: 'No hay nada sonando'}));
        this.add_child(this._vacio);

        // Centrado en el alto que comparte con las otras páginas
        this._cuerpo = new St.BoxLayout({
            style_class: 'riel-musica-cuerpo',
            vertical: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._cuerpo);
        this._armarCuerpo();

        this._reproductores = new Reproductores();
        this._reproductores.connect('cambio', () => this._dibujar());

        this._mezclador = Volume.getMixerControl();
        this._mezclador.connectObject(
            'stream-added', () => this._buscarVolumen(),
            'stream-removed', () => this._buscarVolumen(), this);

        this.connect('destroy', () => {
            this._detenerSondeo();
            this._soltarReproductor();
            this._reproductores.destroy();
        });
        this._dibujar();
    }

    // El carrusel abre en Música si hay algún reproductor
    preferida() {
        return this._reproductores.todos.length > 0;
    }

    // Cada vez que se abre el carrusel se muestra el que sonó último; al ir
    // y volver de otra página se respeta el que se eligió con ‹ ›
    alAbrirCarrusel() {
        this._elegido = null;
    }

    alMostrar() {
        this._visible = true;
        this._encabezado.arrancar();
        this._dibujar();
    }

    alOcultar() {
        this._visible = false;
        this._encabezado.detener();
        this._detenerSondeo();
    }

    _armarCuerpo() {
        const arriba = new St.BoxLayout({style_class: 'riel-musica-arriba'});
        // Recuadro de la carátula; sin carátula, una nota chica en el centro
        this._marco = new St.Bin({
            style_class: 'riel-musica-caratula',
            width: TAMANO_CARATULA,
            height: TAMANO_CARATULA,
        });
        this._caratula = new St.Icon({x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this._marco.set_child(this._caratula);
        arriba.add_child(this._marco);

        const datos = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._titulo = new St.Label({style_class: 'riel-musica-titulo'});
        this._artista = new St.Label({style_class: 'riel-musica-artista'});
        const filaApp = new St.BoxLayout({style_class: 'riel-musica-app'});
        this._nombreApp = new St.Label({style_class: 'riel-musica-app-nombre', y_align: Clutter.ActorAlign.CENTER, x_expand: true});
        this._anteriorRep = boton('pan-start-symbolic', 'Reproductor anterior');
        this._siguienteRep = boton('pan-end-symbolic', 'Reproductor siguiente');
        this._anteriorRep.connect('clicked', () => this._cambiarReproductor(-1));
        this._siguienteRep.connect('clicked', () => this._cambiarReproductor(1));
        filaApp.add_child(this._nombreApp);
        filaApp.add_child(this._anteriorRep);
        filaApp.add_child(this._siguienteRep);
        datos.add_child(this._titulo);
        datos.add_child(this._artista);
        datos.add_child(filaApp);
        arriba.add_child(datos);
        this._cuerpo.add_child(arriba);

        // Barra de progreso: arrastrarla o hacer clic salta a ese punto
        const progreso = new St.BoxLayout({style_class: 'riel-musica-progreso'});
        this._transcurrido = new St.Label({style_class: 'riel-musica-tiempo', y_align: Clutter.ActorAlign.CENTER});
        this._barra = new Slider(0);
        this._barra.x_expand = true;
        this._barra.accessible_name = 'Posición';
        this._barra.connect('drag-begin', () => (this._arrastrando = true));
        this._barra.connect('drag-end', () => {
            this._arrastrando = false;
            this._reproductor?.saltarA(this._barra.value * this._reproductor.duracion);
        });
        this._barra.connect('notify::value', () => {
            if (this._arrastrando && this._reproductor)
                this._mostrarTiempo(this._barra.value * this._reproductor.duracion);
        });
        this._restante = new St.Label({style_class: 'riel-musica-tiempo', y_align: Clutter.ActorAlign.CENTER});
        progreso.add_child(this._transcurrido);
        progreso.add_child(this._barra);
        progreso.add_child(this._restante);
        this._cuerpo.add_child(progreso);

        const controles = new St.BoxLayout({style_class: 'riel-musica-controles'});
        const centro = new St.BoxLayout({style_class: 'riel-musica-botones', x_expand: true, x_align: Clutter.ActorAlign.CENTER});
        this._anterior = boton('media-skip-backward-symbolic', 'Anterior');
        this._play = boton('media-playback-start-symbolic', 'Reproducir', 'riel-boton-redondo riel-musica-play');
        this._siguiente = boton('media-skip-forward-symbolic', 'Siguiente');
        this._anterior.connect('clicked', () => this._reproductor?.anterior());
        this._play.connect('clicked', () => this._reproductor?.playPause());
        this._siguiente.connect('clicked', () => this._reproductor?.siguiente());
        centro.add_child(this._anterior);
        centro.add_child(this._play);
        centro.add_child(this._siguiente);
        controles.add_child(centro);

        // Volumen de la app en el mezclador; oculto si no se encuentra
        this._volumen = new St.BoxLayout({style_class: 'riel-musica-volumen'});
        this._volumen.add_child(new St.Icon({icon_name: 'audio-volume-high-symbolic', style_class: 'riel-boton-icono', y_align: Clutter.ActorAlign.CENTER}));
        this._barraVolumen = new Slider(0);
        this._barraVolumen.accessible_name = 'Volumen';
        this._barraVolumen.x_expand = true;
        this._barraVolumen.connect('notify::value', () => {
            if (!this._flujo || this._volumenPropio)
                return;
            this._flujo.volume = this._barraVolumen.value * this._mezclador.get_vol_max_norm();
            this._flujo.push_volume();
        });
        this._volumen.add_child(this._barraVolumen);
        controles.add_child(this._volumen);
        this._cuerpo.add_child(controles);
    }

    _cambiarReproductor(paso) {
        const todos = this._reproductores.todos;
        if (todos.length < 2)
            return;
        const actual = Math.max(0, todos.indexOf(this._reproductor));
        this._elegido = todos[((actual + paso) % todos.length + todos.length) % todos.length].nombreBus;
        this._dibujar();
    }

    _dibujar() {
        const todos = this._reproductores.todos;
        const r = todos.find(x => x.nombreBus === this._elegido) ?? todos[0] ?? null;
        this._elegido = r?.nombreBus ?? null;
        if (r !== this._reproductor) {
            this._soltarReproductor();
            this._reproductor = r;
            r?.connectObject('posicion', (_r, segundos) => this._ponerPosicion(segundos), this);
            this._buscarVolumen();
        }
        this._vacio.visible = !r;
        this._cuerpo.visible = !!r;
        if (!r) {
            this._detenerSondeo();
            return;
        }

        this._titulo.text = r.titulo;
        this._artista.text = r.artistas;
        this._artista.visible = !!r.artistas;
        this._nombreApp.text = r.nombre;
        this._anteriorRep.visible = this._siguienteRep.visible = todos.length > 1;
        if (r.caratula) {
            this._caratula.gicon = new Gio.FileIcon({file: Gio.File.new_for_uri(r.caratula)});
            this._caratula.icon_size = TAMANO_CARATULA;
            this._marco.remove_style_pseudo_class('vacia');
        } else {
            this._caratula.icon_name = 'audio-x-generic-symbolic';
            this._caratula.icon_size = 40;
            this._marco.add_style_pseudo_class('vacia');
        }

        this._play.child.icon_name = r.sonando ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._play.accessible_name = r.sonando ? 'Pausar' : 'Reproducir';
        this._anterior.reactive = r.puedeAnterior;
        this._siguiente.reactive = r.puedeSiguiente;
        this._barra.reactive = r.puedeSaltar;
        this._barra.visible = r.duracion > 0;
        this._restante.visible = r.duracion > 0;

        if (this._visible && r.sonando)
            this._arrancarSondeo();
        else
            this._detenerSondeo();
        this._consultarPosicion();
    }

    // Un solo temporizador, aunque lleguen muchos avisos del reproductor
    _arrancarSondeo() {
        if (this._sondeo)
            return;
        this._sondeo = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._consultarPosicion();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _detenerSondeo() {
        if (this._sondeo)
            GLib.source_remove(this._sondeo);
        this._sondeo = 0;
    }

    async _consultarPosicion() {
        const r = this._reproductor;
        if (!r || !this._visible)
            return;
        const segundos = await r.posicion();
        if (r === this._reproductor)
            this._ponerPosicion(segundos);
    }

    _ponerPosicion(segundos) {
        const duracion = this._reproductor?.duracion ?? 0;
        if (!this._arrastrando && duracion > 0)
            this._barra.value = Math.min(1, segundos / duracion);
        if (!this._arrastrando)
            this._mostrarTiempo(segundos);
    }

    _mostrarTiempo(segundos) {
        const duracion = this._reproductor?.duracion ?? 0;
        this._transcurrido.text = tiempo(segundos);
        this._restante.text = `-${tiempo(duracion - segundos)}`;
    }

    _soltarReproductor() {
        this._reproductor?.disconnectObject(this);
        this._reproductor = null;
    }

    // El flujo de audio de la app del reproductor (por nombre o id)
    _buscarVolumen() {
        this._flujo?.disconnectObject(this);
        const claves = this._reproductor?.claves ?? [];
        this._flujo = this._mezclador.get_sink_inputs().find(f => {
            const nombres = [f.get_application_id(), f.get_name()].filter(Boolean).map(x => x.toLowerCase());
            return nombres.some(n => claves.some(c => n.includes(c) || c.includes(n)));
        }) ?? null;
        this._volumen.visible = !!this._flujo;
        if (!this._flujo)
            return;
        const leer = () => {
            // Evita que el cambio que llega del mezclador se reenvíe
            this._volumenPropio = true;
            this._barraVolumen.value = this._flujo.volume / this._mezclador.get_vol_max_norm();
            this._volumenPropio = false;
        };
        this._flujo.connectObject('notify::volume', leer, this);
        leer();
    }
});
