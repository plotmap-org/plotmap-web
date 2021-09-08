import { EventMap, event, EventMapListenAt } from "@domx/eventmap";
import { Middleware } from "@domx/middleware";
export {
    customDataElements,
    customDataElement,
    DataElement,
    DataElementCtor,
    DataElementMetaData,
    dataProperty,
    event
};
import { RootState } from "./RootState";



/** Add custom element methods to HTMLElement */
declare global {
    interface HTMLElement {
        connectedCallback(): void;
        disconnectedCallback(): void;
    }
}

/** Defines the static fields of a DataElement */
interface DataElementCtor extends Function {
    __elementName: string,
    dataProperties: DataProperties;
    stateIdProperty: string
}

/** Generic object key index accessor */
interface StringKeyIndex<T> { [key:string]:T }

interface DataProperties extends StringKeyIndex<DataProperty> {}

interface DataProperty {
    changeEvent?: string
    statePath?: string,
    windowEventName?: string,
    windowEventHandler?: EventListener
}

interface DataElementMetaData {
    elementName: string,
    element: DataElement,
    dataProperties: DataProperties
};

/**
 * Used to keep track of how many data elements
 * are using the same state key.
 */
const stateRefs:StringKeyIndex<number> = {};

const connectedMiddleware = new Middleware();
const disconnectedMiddleware = new Middleware();

/**
 * Base class for data elements.
 */
class DataElement extends EventMap(HTMLElement) {
    static eventsStopImmediatePropagation = true;
    static __elementName = "data-element";
    static stateIdProperty:string = "stateId";
    static dataProperties:DataProperties = {
        state: {changeEvent:"state-changed"}
    };

    static applyMiddlware(connectedFn:Function, disconnectedFn: Function) {
        connectedMiddleware.use(connectedFn);
        disconnectedMiddleware.use(disconnectedFn);
    }

    static clearMiddleware() {
        connectedMiddleware.clear();
        disconnectedMiddleware.clear();
    }

    connectedCallback() {
        elementConnected(this); 
    }

    disconnectedCallback() {
        elementDisconnected(this);
    }

    /**
     * Refreshes the state with RootState; useful
     * for when changing the stateId property.
     */
    refreshState() {
        elementDisconnected(this);
        elementConnected(this); 
    }

    /**
     * Dispatches a change event on this DataElement.
     * @param prop {string} the name of the property to dispatch the change event on; default is "state"
     */
    dispatchChange(prop:string = "state") {
        const ctor = this.constructor as DataElementCtor;
        this.dispatchEvent(new CustomEvent(ctor.dataProperties[prop].changeEvent as string));
    }
}

/**
 * Custom DataElement Registry
 */
const customDataElements = {
    /**
     * Defines the custom element with window.customElements.define
     * and tags the element name for use in RootState.
     * @param elementName {string}
     * @param element {CustomElementConstructor}
     */
    define: (elementName:string, element:CustomElementConstructor) => {
        setProp(element, "__elementName", elementName);
        window.customElements.define(elementName, element);
    }
};


interface CustomDataElementOptions {
    /** Sets which property is to be used as the stateId; default: stateId */
    stateIdProperty?: string,
    /** Sets the default event listener element for events; default: "self" */
    eventsListenAt?: EventMapListenAt|string
}
/**
 * A class decorator that defines the custom element with
 * `window.customElements.define` and tags the element name
 * for use in RootState.
 * 
 * Options allow for setting `stateIdProperty` and `eventsListenAt`.
 * @param elementName {string}
 * @param options {CustomDataElementOptions}
 */
const customDataElement = (elementName:string, options:CustomDataElementOptions={}) =>
    (ctor: CustomElementConstructor) => {    
    options.stateIdProperty && setProp(ctor, "stateIdProperty", options.stateIdProperty);
    options.eventsListenAt && setProp(ctor, "eventsListenAt", options.eventsListenAt);
    customDataElements.define(elementName, ctor);
};



interface DataPropertyOptions {
    changeEvent:string
}
/**
 * A property decorator that tags a class property
 * as a state property.
 * 
 * Options allow for setting the change event name.
 * @param options 
 */
const dataProperty = (options?:DataPropertyOptions):any =>
    (prototype: any, propertyName: string) =>
        (prototype.constructor as DataElementCtor).dataProperties[propertyName] = {
            changeEvent: options ? options.changeEvent : `${propertyName}-changed`
        };


const elementConnected = (el:DataElement) => {
    const ctor = el.constructor as DataElementCtor;
        
    const stateId = getProp(el, ctor.stateIdProperty);
    const stateIdPath = stateId ? `.${stateId}` : "";

    Object.keys(ctor.dataProperties).forEach((propertyName) => {

        // set up each data property
        const dp = ctor.dataProperties[propertyName];
        const statePath = `${ctor.__elementName}.${propertyName}${stateIdPath}`;
        const changeEvent = dp.changeEvent || `${propertyName}-changed`;
        const windowEventName = `${statePath}-changed`;
        ctor.dataProperties[propertyName] = {
            ...dp,
            changeEvent,
            statePath,
            windowEventName
        };

        // add to the stateRefs
        stateRefs[statePath] = stateRefs[statePath] ? stateRefs[statePath] + 1 : 1;

        // set initial state
        const initialState = RootState.get(statePath);
        if (initialState === null) {
            RootState.set(statePath, getProp<object>(el, propertyName));
        } else {
            setProp(el, propertyName, initialState);
            triggerSyncEvent(el, changeEvent);
        }

        // add local event handler to push changes to RootState 
        // and other elements with the same statePath
        el.addEventListener(changeEvent, ((event:CustomEvent) => {
            if (event.detail?.isSyncUpdate !== true) {
                RootState.set(statePath, getProp(el, propertyName));
                triggerGlobalEvent(el, windowEventName);
            }
        }) as EventListener);

        // add global event handler
        const windowEventHandler = (event: Event) => {
            if (getProp<any>(event, "detail")?.sourceElement !== el) {
                setProp(el, propertyName,RootState.get(statePath));
                triggerSyncEvent(el, changeEvent);
            }
        };
        ctor.dataProperties[propertyName].windowEventHandler = windowEventHandler;
        window.addEventListener(windowEventName, windowEventHandler);
    });    
    connectedMiddleware.mapThenExecute(getMiddlewareMetaData(el), () => {}, []);
};

const getMiddlewareMetaData = (el:DataElement):DataElementMetaData => {
    const ctor = el.constructor as DataElementCtor;
    const metaData:DataElementMetaData = {
        elementName: ctor.__elementName,
        element: el,
        dataProperties: ctor.dataProperties
    };
    return metaData;
};


const triggerSyncEvent = (el:DataElement, changeEvent:string) =>
    el.dispatchEvent(new CustomEvent(changeEvent, {detail:{isSyncUpdate:true}}));

const triggerGlobalEvent = (el: DataElement, changeEvent:string) =>
    window.dispatchEvent(new CustomEvent(changeEvent, {detail: {sourceElement:el}}))


/**
 * Decrements each data properties state path reference.
 * If 0, then removes the state from RootState.
 * Also removes the window event handler
 * @param el {DataElement}
 */
const elementDisconnected = (el:DataElement) => {
    const ctor = el.constructor as DataElementCtor;
    Object.keys(ctor.dataProperties).forEach((propertyName) => {
        const dp = ctor.dataProperties[propertyName];
        const statePath = dp.statePath as string;
        stateRefs[statePath] = stateRefs[statePath] - 1;
        stateRefs[statePath] === 0 && RootState.delete(statePath);
        window.removeEventListener(dp.windowEventName as string,
            dp.windowEventHandler as EventListener);
        delete dp.windowEventName;
        delete dp.windowEventHandler;
    });
    disconnectedMiddleware.mapThenExecute(getMiddlewareMetaData(el), () => {}, []);
};


/** Helper for getting dynamic properties */
const getProp = <T>(obj:object, name:string):T => {
    //@ts-ignore TS7053 access dynamic property
    return obj[name] as T;
};


/** Helper for setting dyanmic properties */
const setProp = <T>(obj:object, name:string, value:T) => {
    //@ts-ignore TS7053 access dynamic property
    obj[name] = value;
};