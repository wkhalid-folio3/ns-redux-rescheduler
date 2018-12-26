/**
 * @author: Waleed
 * @fileOverview: This script provides as a wrapper for the native redux.js to provide state management for
 * NS scheduled script while providing abstraction to redux management process.
 *
 * Dependencies:
 * - Redux.js
 * 
 * @type {{resumeToRescheduledState, initializeScriptState, currentState, registerEventsForStateUpdate, propagateState, storeStateForRescheduling}}
 */

var stateHelper = (function(){
    var stateObj = {};

    var additionalActionsObject = {};

    function setPropsToState(state, payload){
        for (var key in payload){
            state[key] = payload[key];
        }
        return state;
    }

    function isRescheduleNeeded(){
        var context = nlapiGetContext();
        var usageRemaining = context.getRemainingUsage();

        if (usageRemaining < 900) {
            store.dispatch({type:"RESCHEDULE",payload:{}});
            return true;
        }else{
            return false;
        }
    }

    function stateDispatcher(state, action) {
        if (typeof state === 'undefined' || !state) {
            return stateObj;
        }
        switch (action.type) {
            case 'INITIALIZE':
                action.payload.scriptStatus="STARTED";
                return setPropsToState(state,action.payload);
            case 'RESCHEDULE':
                return setPropsToState(state,{scriptStatus:"RESCHEDULED"});
            default:
                if(!!action.type && additionalActionsObject[action.type] && typeof additionalActionsObject[action.type] == "function"){
                    nlapiLogExecution('DEBUG','executing action type: '+action.type,JSON.stringify(action.payload));
                    var newState = additionalActionsObject[action.type](state , action.payload);
                    return setPropsToState(state,newState);
                }else{
                    nlapiLogExecution('DEBUG','in action type >> else',  action.type + ' : '+JSON.stringify(action.payload));
                    return state
                }
        }
    }

    var store = null;

    return {

        /**
         * This function is responsible to initialize the state object either to new state or rescheduled state.
         * @param {object} oldState. The state to which the store must be initially set to.
         */
        resumeToRescheduledState:function(oldState){
            store.dispatch({type:"INITIALIZE", payload:oldState});
        },

        /**
         * This function is responsible to initialize the script state based on its status.
         * If the status is start then will initialize the script state to the object provided as initialState param.
         * If the status is rescheduled, then the state is loaded from the script parameter with internalID scriptParamName.
         *
         * @param {object} initialState - The state to which the store must be initially set to
         * @param {string} scriptParamName The internalId of the script parameter from which to get the state.
         */
        initializeScriptState:function(initialState,scriptParamName){
            stateObj = initialState;
            stateObj["scriptParamForState"] = scriptParamName;
            store = Redux.createStore(stateDispatcher);
            var scriptParamValue = nlapiGetContext().getSetting('SCRIPT', scriptParamName);

            nlapiLogExecution('AUDIT','script param value loaded', scriptParamValue);

            if (!!scriptParamValue && !!scriptParamName){
                this.resumeToRescheduledState(JSON.parse(scriptParamValue));
            }else{
                this.resumeToRescheduledState(initialState);
            }
        },

        /**
         * Returns the current state of the store
         * @param {void}
         * @returns {any|Promise<NavigationPreloadState>}
         */
        currentState:function(){
            if(!store){
                throw new Error("The store must be initialized before it can be used");
            }
            return store.getState();
        },

        /**
         * This function acts as exposing function for the reducer of Redux.
         * The actions are registered as name with which they are called
         * The callback is any business logic that returns an object as new state
         *
         * @param {string} actionName - name of the action
         * @param {function} callback - business logic returning new state object
         */
        registerEventsForStateUpdate:function(actionName,callback){
            if(typeof callback != "function"){
                throw new Error("The action callback provided is not a function");
            }
            additionalActionsObject[actionName] = callback;
        },

        /**
         * Propagates the state to the new state based on the action provided.
         *
         * Before setting the state, it checks if the script needs to reschedule or not.
         * In case the script is to reschedule, the script status is changed to "RESCHEDULED".
         * The param can be accessed in state's "scriptStatus" property
         *
         * @param {object} action type: the action string, payload(optional): the parameter is entirely dependent
         * on the logic you have provided for the rescheduling.
         * the object that will replace the new state object based on the action implementation
         *
         * @returns {boolean} if script needs to reschedule then returns true else false
         */
        propagateState:function(action){
            isRescheduleNeeded();
            store.dispatch(action);
            return isRescheduleNeeded();
        },

        storeStateForRescheduling:function(){
            var ctx = nlapiGetContext();
            var params = {};
            params[this.currentState().scriptParamForState] = JSON.stringify(this.currentState());
            var status = nlapiScheduleScript(ctx.getScriptId(), ctx.getDeploymentId(), params);
            nlapiLogExecution('AUDIT','resheduling script >> | status '+status+' | param set is: ',JSON.stringify(this.currentState()));
        }
    }
}());