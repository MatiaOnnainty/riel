// Carrusel de la isla central expandida: una página a la vez, cada una con
// su propio tamaño (Música compacta, Calendario grande). Se cambia de página
// con los botones ‹ › de los costados o con los puntos.
//
// Cada página es un actor con avisos opcionales: alAbrirCarrusel(),
// alMostrar() y alOcultar() (para que solo trabaje mientras se ve),
// preferida() (si el carrusel debería abrir en ella) y resumen() con la
// señal 'resumen-cambio' (lo que muestra la isla compacta).
//
// Panel activo: el último en el que se cerró la isla. Ahí vuelve a abrir, y
// es el que resume la isla compacta (señal 'activa-cambio').

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

// Al cambiar de página: la vieja se desvanece, la isla toma el tamaño de la
// nueva y la nueva aparece. Con tamaños distintos queda más limpio que
// deslizar, y solo anima opacidad y tamaño
const SALIDA_MS = 90;
const TAMANO_MS = 200;
const ENTRADA_MS = 140;

export const Carrusel = GObject.registerClass({
    Signals: {'activa-cambio': {}},
}, class Carrusel extends St.BoxLayout {
    _init(paginas) {
        super._init({style_class: 'riel-carrusel', vertical: true});
        this._paginas = paginas;
        this._actual = 0;
        this._ultimo = -1;
        this._visible = false;

        const fila = new St.BoxLayout({style_class: 'riel-carrusel-fila'});
        const flecha = (icono, nombre, paso) => {
            const boton = new St.Button({
                style_class: 'riel-carrusel-flecha',
                child: new St.Icon({icon_name: icono, style_class: 'riel-boton-icono'}),
                accessible_name: nombre,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
                visible: paginas.length > 1,
            });
            boton.connect('clicked', () => this.ir(this._actual + paso));
            return boton;
        };
        fila.add_child(flecha('pan-start-symbolic', 'Panel anterior', -1));

        // La ventana muestra solo la página actual y toma su tamaño
        this._ventana = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true,
            x_expand: true,
        });
        paginas.forEach((pagina, i) => {
            pagina.x_align = Clutter.ActorAlign.CENTER;
            pagina.y_align = Clutter.ActorAlign.START;
            pagina.visible = i === 0;
            this._ventana.add_child(pagina);
        });
        fila.add_child(this._ventana);
        fila.add_child(flecha('pan-end-symbolic', 'Panel siguiente', 1));
        this.add_child(fila);

        this._nombre = new St.Label({style_class: 'riel-carrusel-nombre', x_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._nombre);
        this._puntos = new St.BoxLayout({
            style_class: 'riel-carrusel-puntos',
            x_align: Clutter.ActorAlign.CENTER,
            visible: paginas.length > 1,
        });
        paginas.forEach((pagina, i) => {
            const punto = new St.Button({
                style_class: 'riel-carrusel-punto',
                can_focus: true,
                accessible_name: pagina.nombre,
            });
            punto.connect('clicked', () => this.ir(i));
            this._puntos.add_child(punto);
        });
        this.add_child(this._puntos);
    }

    // Hasta el primer cierre, la primera que diga preferida() (Música si
    // suena, si no Calendario)
    get _indiceActivo() {
        if (this._ultimo >= 0)
            return this._ultimo;
        const preferida = this._paginas.findIndex(pagina => pagina.preferida?.());
        return preferida >= 0 ? preferida : 0;
    }

    get paginaActiva() {
        return this._paginas[this._indiceActivo];
    }

    alAbrir() {
        this._visible = true;
        this._paginas.forEach(pagina => pagina.alAbrirCarrusel?.());
        this.ir(this._indiceActivo, false);
    }

    alCerrar() {
        this._visible = false;
        this._paginas[this._actual].alOcultar?.();
        if (this._ultimo !== this._actual) {
            this._ultimo = this._actual;
            this.emit('activa-cambio');
        }
    }

    // El índice da la vuelta: después de la última viene la primera
    ir(indice, animar = true) {
        const total = this._paginas.length;
        indice = ((indice % total) + total) % total;
        const anterior = this._actual;
        if (anterior !== indice)
            this._paginas[anterior].alOcultar?.();
        this._actual = indice;
        if (this._visible)
            this._paginas[indice].alMostrar?.();

        this._nombre.text = this._paginas[indice].nombre;
        this._nombre.visible = !this._paginas[indice].conTitulo;
        this._puntos.get_children().forEach((punto, i) => {
            if (i === indice)
                punto.add_style_pseudo_class('checked');
            else
                punto.remove_style_pseudo_class('checked');
        });

        // Un cambio anterior a medio animar se corta: queda visible solo la
        // página que se estaba viendo, entera
        const vieja = this._paginas.find(pagina => pagina.visible && pagina !== this._paginas[indice]) ??
            this._paginas[anterior];
        this._ventana.remove_all_transitions();
        this._paginas.forEach(pagina => {
            pagina.remove_all_transitions();
            pagina.opacity = 255;
            pagina.visible = pagina === vieja;
        });
        const nueva = this._paginas[indice];

        if (!animar || vieja === nueva) {
            vieja.visible = false;
            nueva.visible = true;
            this._ventana.set_size(-1, -1);
            return;
        }

        // La ventana queda fija en el tamaño de la vieja mientras se va
        this._ventana.set_size(this._ventana.width, this._ventana.height);
        vieja.ease({
            opacity: 0,
            duration: SALIDA_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                vieja.visible = false;
                vieja.opacity = 255;
                nueva.opacity = 0;
                nueva.visible = true;
                const [, ancho] = nueva.get_preferred_width(-1);
                const [, alto] = nueva.get_preferred_height(ancho);
                this._ventana.ease({
                    width: ancho,
                    height: alto,
                    duration: TAMANO_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => this._ventana.set_size(-1, -1),
                });
                nueva.ease({
                    opacity: 255,
                    delay: TAMANO_MS / 2,
                    duration: ENTRADA_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            },
        });
    }
});
