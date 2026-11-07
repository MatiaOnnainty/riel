// Carrusel de la isla central expandida: una página a la vez, con puntos para
// elegir la página. Cada página es un actor con dos avisos opcionales,
// alMostrar() y alOcultar(), para que solo trabaje mientras se ve (por
// ejemplo, la posición de la canción en Música).

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';

// Ancho de cada página (y del carrusel)
const ANCHO = 440;
const DURACION_MS = 250;

export const Carrusel = GObject.registerClass(
class Carrusel extends St.BoxLayout {
    _init(paginas) {
        super._init({style_class: 'riel-carrusel', vertical: true});
        this._paginas = paginas;
        this._actual = 0;
        this._visible = false;

        // La ventana recorta la tira de páginas. En la tira solo está
        // visible la página actual (así el alto es el suyo); al cambiar se
        // muestran las dos, la tira se desliza y queda solo la nueva
        this._ventana = new St.Widget({clip_to_allocation: true, width: ANCHO});
        this._tira = new St.BoxLayout();
        paginas.forEach((pagina, i) => {
            pagina.width = ANCHO;
            pagina.visible = i === 0;
            this._tira.add_child(pagina);
        });
        this._ventana.add_child(this._tira);
        this.add_child(this._ventana);

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

    // Se abre en la página que cada una pida (la primera que diga
    // preferida()), o en la primera
    alAbrir() {
        this._visible = true;
        const preferida = this._paginas.findIndex(pagina => pagina.preferida?.());
        this.ir(preferida >= 0 ? preferida : 0, false);
    }

    alCerrar() {
        this._visible = false;
        this._paginas[this._actual].alOcultar?.();
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

        this._puntos.get_children().forEach((punto, i) => {
            if (i === indice)
                punto.add_style_pseudo_class('checked');
            else
                punto.remove_style_pseudo_class('checked');
        });

        // Cancela un deslizamiento en curso antes de empezar otro
        this._tira.remove_all_transitions();
        const soloLaNueva = () => {
            this._paginas.forEach((pagina, i) => (pagina.visible = i === indice));
            this._tira.translation_x = 0;
        };
        if (!animar || anterior === indice) {
            soloLaNueva();
            return;
        }

        // Las dos en la tira, en su orden: se desliza hacia la nueva
        this._paginas.forEach((pagina, i) => (pagina.visible = i === indice || i === anterior));
        const haciaAdelante = indice > anterior;
        this._tira.translation_x = haciaAdelante ? 0 : -ANCHO;
        this._tira.ease({
            translation_x: haciaAdelante ? -ANCHO : 0,
            duration: DURACION_MS,
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            onComplete: soloLaNueva,
        });
    }
});

// Página Calendario: el calendario de GNOME, que vuelve al día de hoy cada
// vez que se muestra
export const PaginaCalendario = GObject.registerClass(
class PaginaCalendario extends St.Bin {
    _init() {
        super._init({style_class: 'riel-pagina riel-pagina-calendario', x_expand: true});
        this.nombre = 'Calendario';
        this._calendario = new Calendar.Calendar();
        // Sin fuente de eventos no arma la grilla; la vacía no marca eventos
        this._calendario.setEventSource(new Calendar.EmptyEventSource());
        this.set_child(this._calendario);
    }

    alMostrar() {
        this._calendario.setDate(new Date());
    }
});
