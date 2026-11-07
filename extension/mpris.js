// Reproductores de música por MPRIS (Spotify, Firefox, VLC…). A diferencia
// del módulo de GNOME, da también la posición y la duración de la canción,
// y permite saltar a un punto.
//
// Reproductores: sigue los que aparecen y desaparecen en el bus, y recuerda
// cuál empezó a sonar último (es el que muestra la página Música).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

const PREFIJO = 'org.mpris.MediaPlayer2.';
const RUTA = '/org/mpris/MediaPlayer2';

const InterfazRaiz = `<node><interface name="org.mpris.MediaPlayer2">
  <property name="Identity" type="s" access="read"/>
  <property name="DesktopEntry" type="s" access="read"/>
</interface></node>`;

const InterfazReproductor = `<node><interface name="org.mpris.MediaPlayer2.Player">
  <method name="PlayPause"/>
  <method name="Next"/>
  <method name="Previous"/>
  <method name="SetPosition"><arg type="o" direction="in"/><arg type="x" direction="in"/></method>
  <signal name="Seeked"><arg type="x"/></signal>
  <property name="PlaybackStatus" type="s" access="read"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/>
  <property name="CanPlay" type="b" access="read"/>
  <property name="CanSeek" type="b" access="read"/>
</interface></node>`;

const ProxyRaiz = Gio.DBusProxy.makeProxyWrapper(InterfazRaiz);
const ProxyReproductor = Gio.DBusProxy.makeProxyWrapper(InterfazReproductor);

// Señales: 'cambio' (estado o canción), 'posicion' (salto con Seeked),
// 'cerrado' (el reproductor se fue del bus)
export class Reproductor extends Signals.EventEmitter {
    constructor(nombreBus) {
        super();
        this.nombreBus = nombreBus;
        this.ultimoPlay = 0;
        this._cancelar = new Gio.Cancellable();
        this._listo = this._conectar();
    }

    async _conectar() {
        try {
            this._raiz = await ProxyRaiz.newAsync(Gio.DBus.session, this.nombreBus, RUTA, this._cancelar);
            this._proxy = await ProxyReproductor.newAsync(Gio.DBus.session, this.nombreBus, RUTA, this._cancelar);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`Riel: no se pudo conectar con ${this.nombreBus}: ${e.message}`);
            return;
        }
        this._proxy.connectObject('g-properties-changed', () => this._actualizar(), this);
        this._seeked = this._proxy.connectSignal('Seeked', (_p, _e, [micros]) =>
            this.emit('posicion', micros / 1e6));
        this._raiz.connectObject('notify::g-name-owner', () => {
            if (!this._raiz.g_name_owner)
                this.emit('cerrado');
        }, this);
        this._actualizar();
    }

    _actualizar() {
        if (this.sonando)
            this.ultimoPlay = GLib.get_monotonic_time();
        this.emit('cambio');
    }

    get listo() {
        return !!this._proxy;
    }

    get sonando() {
        return this._proxy?.PlaybackStatus === 'Playing';
    }

    // Metadatos validados (algunos reproductores mandan tipos raros)
    _meta(clave) {
        return this._proxy?.Metadata?.[clave]?.deepUnpack();
    }

    get titulo() {
        const t = this._meta('xesam:title');
        return typeof t === 'string' && t ? t : 'Sin título';
    }

    get artistas() {
        const a = this._meta('xesam:artist');
        return Array.isArray(a) ? a.filter(x => typeof x === 'string').join(', ') : '';
    }

    get caratula() {
        const url = this._meta('mpris:artUrl');
        return typeof url === 'string' ? url : '';
    }

    // Duración en segundos (0 si el reproductor no la informa)
    get duracion() {
        const l = this._meta('mpris:length');
        return typeof l === 'number' || typeof l === 'bigint' ? Number(l) / 1e6 : 0;
    }

    get pista() {
        const id = this._meta('mpris:trackid');
        return typeof id === 'string' ? id : '';
    }

    get puedeSaltar() {
        return !!this._proxy?.CanSeek && this.duracion > 0 && !!this.pista;
    }

    get puedeSiguiente() {
        return !!this._proxy?.CanGoNext;
    }

    get puedeAnterior() {
        return !!this._proxy?.CanGoPrevious;
    }

    get visible() {
        return !!this._proxy?.CanPlay;
    }

    get app() {
        const entrada = this._raiz?.DesktopEntry;
        return entrada ? Shell.AppSystem.get_default().lookup_app(`${entrada}.desktop`) : null;
    }

    get nombre() {
        return this.app?.get_name() ?? this._raiz?.Identity ?? this.nombreBus.slice(PREFIJO.length);
    }

    // Para encontrar su volumen en el mezclador
    get claves() {
        return [this._raiz?.DesktopEntry, this._raiz?.Identity, this.nombreBus.slice(PREFIJO.length).split('.')[0]]
            .filter(Boolean).map(x => x.toLowerCase());
    }

    playPause() {
        this._proxy?.PlayPauseAsync().catch(() => {});
    }

    siguiente() {
        this._proxy?.NextAsync().catch(() => {});
    }

    anterior() {
        this._proxy?.PreviousAsync().catch(() => {});
    }

    saltarA(segundos) {
        if (this.puedeSaltar)
            this._proxy.SetPositionAsync(this.pista, Math.round(segundos * 1e6)).catch(() => {});
    }

    // La posición no avisa cuando avanza: se pide al bus cada vez que hace
    // falta (y solo mientras la página se ve)
    async posicion() {
        if (!this._proxy)
            return 0;
        try {
            const [valor] = (await Gio.DBus.session.call(this.nombreBus, RUTA,
                'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
                null, Gio.DBusCallFlags.NONE, 1000, this._cancelar)).deepUnpack();
            return Number(valor.deepUnpack()) / 1e6;
        } catch {
            return 0;
        }
    }

    destroy() {
        this._cancelar.cancel();
        this._proxy?.disconnectObject(this);
        if (this._seeked)
            this._proxy.disconnectSignal(this._seeked);
        this._raiz?.disconnectObject(this);
        this._proxy = null;
        this._raiz = null;
    }
}

// Señal: 'cambio' cuando aparece, se va o cambia cualquier reproductor
export class Reproductores extends Signals.EventEmitter {
    constructor() {
        super();
        this._lista = new Map();
        this._idNombres = Gio.DBus.session.signal_subscribe('org.freedesktop.DBus',
            'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus', null,
            Gio.DBusSignalFlags.NONE, (_c, _s, _r, _i, _n, parametros) => {
                const [nombre, antes, ahora] = parametros.deepUnpack();
                if (!nombre.startsWith(PREFIJO))
                    return;
                if (ahora && !antes)
                    this._agregar(nombre);
                else if (!ahora)
                    this._quitar(nombre);
            });
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'ListNames', null, null, Gio.DBusCallFlags.NONE, -1, null)
            .then(r => r.deepUnpack()[0].filter(n => n.startsWith(PREFIJO)).forEach(n => this._agregar(n)))
            .catch(() => {});
    }

    _agregar(nombre) {
        if (this._lista.has(nombre) || !this._lista)
            return;
        const r = new Reproductor(nombre);
        r.connect('cambio', () => this.emit('cambio'));
        r.connect('cerrado', () => this._quitar(nombre));
        this._lista.set(nombre, r);
    }

    _quitar(nombre) {
        const r = this._lista?.get(nombre);
        if (!r)
            return;
        this._lista.delete(nombre);
        r.destroy();
        this.emit('cambio');
    }

    // Los que se pueden mostrar, el que sonó último primero
    get todos() {
        return [...this._lista.values()].filter(r => r.listo && r.visible)
            .sort((a, b) => b.ultimoPlay - a.ultimoPlay);
    }

    destroy() {
        Gio.DBus.session.signal_unsubscribe(this._idNombres);
        this._lista.forEach(r => r.destroy());
        this._lista = null;
    }
}
