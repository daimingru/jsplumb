import {jsPlumbDefaults, jsPlumbHelperFunctions} from "../defaults";
import {Dictionary, jsPlumbInstance, Offset, PointArray, Size} from "../core";
import {BrowserRenderer} from "./browser-renderer";
import {isString, uuid} from "../util";
import {DragManager} from "./drag-manager";
import {ElementDragHandler} from "./element-drag-handler";
import {EndpointDragHandler} from "./endpoint-drag-handler";
import {GroupDragHandler} from "./group-drag-handler";
import {addClass, consume, findParent, getClass, hasClass, removeClass, toggleClass} from "../browser/browser-util";
import * as Constants from "../constants";
import { UIGroup } from "../group/group";
import {EventManager} from "./event-manager";

export interface DragEventCallbackOptions {
    drag: {
        size: [ number, number ];
        getDragElement: () => HTMLElement;
    }; // The associated Drag instance
    e: MouseEvent;
    el: HTMLElement; // element being dragged
    pos: [number, number]; // x,y location of the element. drag event only.

}

export interface DragOptions {
    containment?: string;
    start?: (params:DragEventCallbackOptions) => void;
    drag?: (params:DragEventCallbackOptions) => void;
    stop?: (params:DragEventCallbackOptions) => void;
    cursor?: string;
    zIndex?: number;
}

export interface BrowserJsPlumbDefaults extends jsPlumbDefaults {
    dragOptions?: DragOptions;
}

export interface jsPlumbDOMElement extends HTMLElement {
    _jsPlumbGroup: UIGroup;
    _isJsPlumbGroup: boolean;
    offsetParent: HTMLElement;
    getAttribute:(name:string) => string;
}

export type PosseSpec = string | { id:string, active:boolean };



function _genLoc (prefix:string, e?:Event):PointArray {
    if (e == null) {
        return [ 0, 0 ];
    }
    let ts = _touches(e), t = _getTouch(ts, 0);
    return [t[prefix + "X"], t[prefix + "Y"]];
}

const _pageLocation = _genLoc.bind(null, "page");

function _getTouch (touches:any, idx:number):Touch {
    return touches.item ? touches.item(idx) : touches[idx];
}
function _touches (e:Event):Array<Touch> {
    let _e = <any>e;
    return _e.touches && _e.touches.length > 0 ? _e.touches :
        _e.changedTouches && _e.changedTouches.length > 0 ? _e.changedTouches :
            _e.targetTouches && _e.targetTouches.length > 0 ? _e.targetTouches :
                [ _e ];
}

// ------------------------------------------------------------------------------------------------------------

export class BrowserJsPlumbInstance extends jsPlumbInstance {

    dragManager:DragManager;
    _connectorClick:Function;
    _connectorDblClick:Function;
    _endpointClick:Function;
    _endpointDblClick:Function;
    _overlayClick:Function;
    _overlayDblClick:Function;

    _connectorMouseover:Function;
    _connectorMouseout:Function;
    _endpointMouseover:Function;
    _endpointMouseout:Function;

    _overlayMouseover:Function;
    _overlayMouseout:Function;

    eventManager:EventManager;

    private elementDragHandler :ElementDragHandler;

    constructor(protected _instanceIndex:number, defaults?:BrowserJsPlumbDefaults, helpers?:jsPlumbHelperFunctions) {
        super(_instanceIndex, new BrowserRenderer(), defaults, helpers);
        // not very clean: cant pass this in to BrowserRenderer as we're in the constructor of this class. this should be cleaned up.
        (this.renderer as BrowserRenderer).instance = this;

        //this.eventManager = new Mottle();
        this.eventManager = new EventManager();
        this.dragManager = new DragManager(this);

        this.dragManager.addHandler(new EndpointDragHandler(this));
        this.dragManager.addHandler(new GroupDragHandler(this));
        this.elementDragHandler = new ElementDragHandler(this);
        this.dragManager.addHandler(this.elementDragHandler);

        const _connClick = function(event:string, e:any) {
            if (!e.defaultPrevented) {
                let connectorElement = findParent(e.srcElement || e.target, Constants.SELECTOR_CONNECTOR, this.getContainer());
                this.fire(event, (<any>connectorElement).jtk.connector.connection, e);
            }
        };
        this._connectorClick = _connClick.bind(this, Constants.EVENT_CLICK);
        this._connectorDblClick = _connClick.bind(this, Constants.EVENT_DBL_CLICK);

        const _connectorHover = function(state:boolean, e:any) {
            const el = (e.srcElement || e.target).parentNode;
            if (el.jtk && el.jtk.connector) {
                this.renderer.setConnectorHover(el.jtk.connector, state);
            }
        };

        this._connectorMouseover = _connectorHover.bind(this, true);
        this._connectorMouseout = _connectorHover.bind(this, false);

        const _epClick = function(event:string, e:any) {
            if (!e.defaultPrevented) {
                let endpointElement = findParent(e.srcElement || e.target, Constants.SELECTOR_ENDPOINT, this.getContainer());
                this.fire(event, (<any>endpointElement).jtk.endpoint, e);
            }
        };

        this._endpointClick = _epClick.bind(this, Constants.EVENT_ENDPOINT_CLICK);
        this._endpointDblClick = _epClick.bind(this, Constants.EVENT_ENDPOINT_DBL_CLICK);

        const _endpointHover = function(state: boolean, e:any) {
            const el = e.srcElement || e.target;
            if (el.jtk && el.jtk.endpoint) {
                this.renderer.setEndpointHover(el.jtk.endpoint, state);
            }
        };
        this._endpointMouseover = _endpointHover.bind(this, true);
        this._endpointMouseout = _endpointHover.bind(this, false);

        const _oClick = function(method:string, e:any) {
            consume(e);
            let overlayElement = findParent(e.srcElement || e.target, Constants.SELECTOR_OVERLAY, this.getContainer());
            let overlay = (<any>overlayElement).jtk.overlay;
            overlay[method](e);
        };

        this._overlayClick = _oClick.bind(this, "click");
        this._overlayDblClick = _oClick.bind(this, "dblClick");

        const _overlayHover = function(state:boolean, e:any) {
            let overlayElement = findParent(e.srcElement || e.target, Constants.SELECTOR_OVERLAY, this.getContainer());
            let overlay = (<any>overlayElement).jtk.overlay;
            if (overlay) {
                this.renderer.setOverlayHover(overlay, state);
            }
        };

        this._overlayMouseover = _overlayHover.bind(this, true);
        this._overlayMouseout = _overlayHover.bind(this, false);

        this._attachEventDelegates();
    }

    getElement(el:HTMLElement|string):HTMLElement {
        if (el == null) {
            return null;
        }
        // here we pluck the first entry if el was a list of entries.
        // this is not my favourite thing to do, but previous versions of
        // jsplumb supported jquery selectors, and it is possible a selector
        // will be passed in here.
        return (typeof el === "string" ? document.getElementById(el) : el) as HTMLElement;
    }

    getElementById(elId: string): HTMLElement {
        return document.getElementById(elId);
    }

    removeElement(element:HTMLElement | string):void {
        // seems to barf at the moment due to scoping. might need to produce a new
        // version of mottle.
        this.eventManager.remove(element);
    }

    appendElement(el:HTMLElement, parent:HTMLElement):void {
        if (parent) {
            parent.appendChild(el);
        }
    }

    _getAssociatedElements(el: HTMLElement): Array<HTMLElement> {
        let els = el.querySelectorAll("[jtk-managed]");
        let a:Array<HTMLElement> = [];
        Array.prototype.push.apply(a, els);
        return a;
    }


    shouldFireEvent(event: string, value: any, originalEvent?: Event): boolean {
        return true;
    }

    getClass(el:HTMLElement):string { return getClass(el); }

    addClass(el:HTMLElement, clazz:string):void {
        addClass(el, clazz);
    }

    hasClass(el:HTMLElement, clazz:string):boolean {
        return hasClass(el, clazz);
    }

    removeClass(el:HTMLElement, clazz:string):void {
        removeClass(el, clazz);
    }

    toggleClass(el:HTMLElement, clazz:string):void {
        toggleClass(el, clazz);
    }

    setAttribute(el:HTMLElement, name:string, value:string):void {
        el.setAttribute(name, value);
    }

    getAttribute(el:HTMLElement, name:string):string {
        return el.getAttribute(name);
    }

    setAttributes(el:HTMLElement, atts:Dictionary<string>) {
        for (let i in atts) {
            el.setAttribute(i, atts[i]);
        }
    }

    removeAttribute(el:HTMLElement, attName:string) {
        el.removeAttribute && el.removeAttribute(attName);
    }

    on (el:HTMLElement, event:string, callbackOrSelector:Function|string, callback?:Function) {
        if (callback == null) {
            this.eventManager.on(el, event, callbackOrSelector);
        } else {
            this.eventManager.on(el, event, callbackOrSelector, callback);
        }
        return this;
    }

    off (el:HTMLElement, event:string, callback:Function) {

        this.eventManager.off(el, event, callback);

        return this;
    }

    trigger(el:HTMLElement, event:string, originalEvent?:Event, payload?:any) {
        this.eventManager.trigger(el, event, originalEvent, payload);
    }

    _getOffset(el:HTMLElement, relativeToRoot?:boolean, container?:HTMLElement):Offset {
        container = container || this.getContainer();
        let out:Offset = {
                left: el.offsetLeft,
                top: el.offsetTop
            },
            op = ( (relativeToRoot  || (container != null && (el !== container && el.offsetParent !== container))) ?  el.offsetParent : null ) as HTMLElement,
            _maybeAdjustScroll = (offsetParent:HTMLElement) => {
                if (offsetParent != null && offsetParent !== document.body && (offsetParent.scrollTop > 0 || offsetParent.scrollLeft > 0)) {
                    out.left -= offsetParent.scrollLeft;
                    out.top -= offsetParent.scrollTop;
                }
            };

        while (op != null) {
            out.left += op.offsetLeft;
            out.top += op.offsetTop;
            _maybeAdjustScroll(op);
            op = (relativeToRoot ? op.offsetParent :
                op.offsetParent === container ? null : op.offsetParent) as HTMLElement;
        }

        // if container is scrolled and the element (or its offset parent) is not absolute or fixed, adjust accordingly.
        if (container != null && !relativeToRoot && (container.scrollTop > 0 || container.scrollLeft > 0)) {
            let pp = el.offsetParent != null ? this.getStyle(el.offsetParent as HTMLElement, "position") : "static",
                p = this.getStyle(el, "position");
            if (p !== "absolute" && p !== "fixed" && pp !== "absolute" && pp !== "fixed") {
                out.left -= container.scrollLeft;
                out.top -= container.scrollTop;
            }
        }

        return out;
    }

    _getSize(el:HTMLElement):Size {
        return [ el.offsetWidth, el.offsetHeight ];
    }

    createElement(tag:string, style?:Dictionary<any>, clazz?:string, atts?:Dictionary<string>):HTMLElement {
        return this.createElementNS(null, tag, style, clazz, atts);
    }

    createElementNS(ns:string, tag:string, style?:Dictionary<any>, clazz?:string, atts?:Dictionary<string>):HTMLElement {
        let e = (ns == null ? document.createElement(tag) : document.createElementNS(ns, tag)) as HTMLElement;
        let i;
        style = style || {};
        for (i in style) {
            e.style[i] = style[i];
        }

        if (clazz) {
            e.className = clazz;
        }

        atts = atts || {};
        for (i in atts) {
            e.setAttribute(i, "" + atts[i]);
        }

        return e;
    }

    getStyle(el:HTMLElement, prop:string):any {
        if (typeof window.getComputedStyle !== 'undefined') {
            return getComputedStyle(el, null).getPropertyValue(prop);
        } else {
            return (<any>el).currentStyle[prop];
        }
    }

    getSelector(ctx:string | HTMLElement, spec:string):NodeListOf<any> {

        let sel:NodeListOf<any> = null;
        if (arguments.length === 1) {
            if (!isString(ctx)) {

                let nodeList = document.createDocumentFragment();
                nodeList.appendChild(ctx as HTMLElement);

                //return ctx as [ HTMLElement ];
                return nodeList.childNodes;
            }

            sel = document.querySelectorAll(<string>ctx);
        }
        else {
            sel = (<HTMLElement>ctx).querySelectorAll(<string>spec);
        }

        return sel;
    }

    setPosition(el:HTMLElement, p:Offset):void {
        el.style.left = p.left + "px";
        el.style.top = p.top + "px";
    }

    //
    // TODO investigate if this is still entirely necessary, since its only used by the drag stuff yet is declared as abstract on the jsPlumbInstance class.
    //
    getUIPosition(eventArgs:any):Offset {
        // here the position reported to us by Katavorio is relative to the element's offsetParent. For top
        // level nodes that is fine, but if we have a nested draggable then its offsetParent is actually
        // not going to be the jsplumb container; it's going to be some child of that element. In that case
        // we want to adjust the UI position to account for the offsetParent's position relative to the Container
        // origin.
        let el = eventArgs[0].el;
        if (el.offsetParent == null) {
            return null;
        }
        let finalPos = eventArgs[0].finalPos || eventArgs[0].pos;
        let p = { left:finalPos[0], top:finalPos[1] };
        if (el._katavorioDrag && el.offsetParent !== this.getContainer()) {
            let oc = this.getOffset(el.offsetParent);
            p.left += oc.left;
            p.top += oc.top;
        }
        return p;
    }

    getDragScope(el:any):string {

        console.log("REGRESSION: getDragScope will not work now that individual elements are not configured as draggables");

        return el._katavorioDrag && el._katavorioDrag.scopes.join(" ") || "";
    }

    getPositionOnElement(evt:Event, el:HTMLElement, zoom:number) {
        let box:any = typeof el.getBoundingClientRect !== "undefined" ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 },
            body = document.body,
            docElem = document.documentElement,
            scrollTop = window.pageYOffset || docElem.scrollTop || body.scrollTop,
            scrollLeft = window.pageXOffset || docElem.scrollLeft || body.scrollLeft,
            clientTop = docElem.clientTop || body.clientTop || 0,
            clientLeft = docElem.clientLeft || body.clientLeft || 0,
            pst = 0,
            psl = 0,
            top = box.top + scrollTop - clientTop + (pst * zoom),
            left = box.left + scrollLeft - clientLeft + (psl * zoom),
            cl = _pageLocation(evt),
            w = box.width || (el.offsetWidth * zoom),
            h = box.height || (el.offsetHeight * zoom),
            x = (cl[0] - left) / w,
            y = (cl[1] - top) / h;

        return [ x, y ];
    }

    setDraggable(element:HTMLElement, draggable:boolean) {
        if (draggable) {
            this.removeAttribute(element, Constants.ATTRIBUTE_NOT_DRAGGABLE);
        } else {
            this.setAttribute(element, Constants.ATTRIBUTE_NOT_DRAGGABLE, "true");
        }
    }

    isDraggable(el:HTMLElement):boolean {
        let d = this.getAttribute(el, Constants.ATTRIBUTE_NOT_DRAGGABLE);
        return d == null || d === "false";
    }

    /*
     * toggles the draggable state of the given element(s).
     * el is either an id, or an element object, or a list of ids/element objects.
     */
    toggleDraggable (el:HTMLElement):boolean {
        let state = this.isDraggable(el);
        this.setDraggable(el, !state);
        return !state;
    }

    private _attachEventDelegates() {
        let currentContainer = this.getContainer();
        this.eventManager.on(currentContainer, Constants.EVENT_CLICK, Constants.SELECTOR_OVERLAY, this._overlayClick);
        this.eventManager.on(currentContainer, Constants.EVENT_DBL_CLICK, Constants.SELECTOR_OVERLAY, this._overlayDblClick);

        this.eventManager.on(currentContainer, Constants.EVENT_CLICK, Constants.SELECTOR_CONNECTOR, this._connectorClick);
        this.eventManager.on(currentContainer, Constants.EVENT_DBL_CLICK, Constants.SELECTOR_CONNECTOR, this._connectorDblClick);

        this.eventManager.on(currentContainer, Constants.EVENT_CLICK, Constants.SELECTOR_ENDPOINT, this._endpointClick);
        this.eventManager.on(currentContainer, Constants.EVENT_DBL_CLICK, Constants.SELECTOR_ENDPOINT, this._endpointDblClick);

        this.eventManager.on(currentContainer, Constants.EVENT_MOUSEOVER, Constants.SELECTOR_CONNECTOR, this._connectorMouseover);
        this.eventManager.on(currentContainer, Constants.EVENT_MOUSEOUT, Constants.SELECTOR_CONNECTOR, this._connectorMouseout);

        this.eventManager.on(currentContainer, Constants.EVENT_MOUSEOVER, Constants.SELECTOR_ENDPOINT, this._endpointMouseover);
        this.eventManager.on(currentContainer, Constants.EVENT_MOUSEOUT, Constants.SELECTOR_ENDPOINT, this._endpointMouseout);

        this.eventManager.on(currentContainer, Constants.EVENT_MOUSEOVER, Constants.SELECTOR_OVERLAY, this._overlayMouseover);
        this.eventManager.on(currentContainer, Constants.EVENT_MOUSEOUT, Constants.SELECTOR_OVERLAY, this._overlayMouseout);
    }

    private _detachEventDelegates() {
        let currentContainer = this.getContainer();
        if (currentContainer) {
            this.eventManager.off(currentContainer, Constants.EVENT_CLICK, this._connectorClick);
            this.eventManager.off(currentContainer, Constants.EVENT_DBL_CLICK, this._connectorDblClick);
            this.eventManager.off(currentContainer, Constants.EVENT_CLICK, this._endpointClick);
            this.eventManager.off(currentContainer, Constants.EVENT_DBL_CLICK, this._endpointDblClick);
            this.eventManager.off(currentContainer, Constants.EVENT_CLICK, this._overlayClick);
            this.eventManager.off(currentContainer, Constants.EVENT_DBL_CLICK, this._overlayDblClick);

            this.eventManager.off(currentContainer, Constants.EVENT_MOUSEOVER, this._connectorMouseover);
            this.eventManager.off(currentContainer, Constants.EVENT_MOUSEOUT, this._connectorMouseout);

            this.eventManager.off(currentContainer, Constants.EVENT_MOUSEOVER, this._endpointMouseover);
            this.eventManager.off(currentContainer, Constants.EVENT_MOUSEOUT, this._endpointMouseout);

            this.eventManager.off(currentContainer, Constants.EVENT_MOUSEOVER, this._overlayMouseover);
            this.eventManager.off(currentContainer, Constants.EVENT_MOUSEOUT, this._overlayMouseout);
        }
    }

    setContainer(c: string | HTMLElement): void {
        this._detachEventDelegates();
        if (this.dragManager != null) {
            this.dragManager.reset();
        }

        const newContainer = this.getElement(c);

        this.setAttribute(newContainer, Constants.ATTRIBUTE_CONTAINER, uuid().replace("-", ""));

        // move all endpoints, connectors, and managed elements
        const currentContainer = this.getContainer();
        if (currentContainer != null) {
            currentContainer.removeAttribute(Constants.ATTRIBUTE_CONTAINER);
            currentContainer.querySelectorAll(".jtk-connector, .jtk-endpoint, div.jtk-overlay, [jtk-managed]").forEach((el: HTMLElement) => {
                newContainer.appendChild(el)
            });
        }

        super.setContainer(newContainer);
        if (this.eventManager != null) {
            this._attachEventDelegates();
        }
        if (this.dragManager != null) {
            this.dragManager.addHandler(new EndpointDragHandler(this));
            this.dragManager.addHandler(new GroupDragHandler(this));
            this.elementDragHandler = new ElementDragHandler(this);
            this.dragManager.addHandler(this.elementDragHandler);
        }
    }

    reset(silently?:boolean) {
        super.reset(silently);
        const container = this.getContainer();
        const els = container.querySelectorAll("[jtk-managed], .jtk-endpoint, .jtk-connector, .jtk-overlay");
        els.forEach((el:any) => el.parentNode && el.parentNode.removeChild(el));
    }

    destroy(): void {

        this._detachEventDelegates();

        if (this.dragManager != null) {
            this.dragManager.reset();
        }

        this.clearDragSelection();

        super.destroy();
    }

    unmanage (id:string):void {
        this.removeFromDragSelection(id);
        super.unmanage(id);
    }

    addToDragSelection(...el:Array<string|HTMLElement>) {
        el.forEach((_el) => this.elementDragHandler.addToDragSelection(_el));
    }

    clearDragSelection() {
        this.elementDragHandler.clearDragSelection();
    }

    removeFromDragSelection(...el:Array<string|HTMLElement>) {
        el.forEach((_el) => this.elementDragHandler.removeFromDragSelection(_el));
    }

    toggleDragSelection(...el:Array<string|HTMLElement>) {
        el.forEach((_el) => this.elementDragHandler.toggleDragSelection(_el));
    }

    getDragSelection():Array<HTMLElement> {
        return this.elementDragHandler.getDragSelection();
    }

    // ------------ posses

    /**
     * Adds the given element(s) to the given posse.
     * @param spec Either the ID of some posse, in which case the elements are all added as 'active', or an object of the form
     * { id:"someId", active:boolean }. In the latter case, `active`, if true, which is the default, indicates whether
     * dragging the given element(s) should cause all the elements in the posse to be dragged. If `active` is false it means the
     * given element(s) is "passive" and should only move when an active member of the posse is dragged.
     * @param els Elements to add to the posse.
     */
    addToPosse(spec:PosseSpec, ...els:Array<HTMLElement>) {
        this.elementDragHandler.addToPosse(spec, ...els);
    }

    /**
     * Removes the given element(s) from any posse they may be in. You don't need to supply the posse id, as elements
     * can only be in one posse anyway.
     * @param els Elements to remove from posses.
     */
    removeFromPosse(...els:Array<HTMLElement>) {
        this.elementDragHandler.removeFromPosse(...els);
    }

    /**
     * Sets the active/passive state for the given element(s).You don't need to supply the posse id, as elements
     * can only be in one posse anyway.
     * @param state true for active, false for passive.
     * @param els
     */
    setPosseState (state:boolean, ...els:Array<HTMLElement>) {
        this.elementDragHandler.setPosseState(state, ...els);
    }

    /**
     * Consumes the given event.
     * @param e
     * @param doNotPreventDefault
     */
    consume (e:Event, doNotPreventDefault?:boolean) {
        consume(e, doNotPreventDefault);
    }
}
