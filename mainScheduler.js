


function getRecordsToProcess(){
    var search = nlapiCreateSearch('salesorder'),
        searchResults = search.runSearch(),
        resultIndex = stateHelper.currentState().orderSearchOffsetCounter,
        resultStep = 1000,
        resultSet;

    resultSet = searchResults.getResults(resultIndex, resultIndex + resultStep);

    return resultSet || [];
}

/**
 * Below functions are responsible for updating specific properties of state
 * @param payload
 * @returns {{orderLoopCounter: number, orderSearchOffsetCounter: number}}
 */
/****************************************************************************************/

/**
 *
 * @param {object} currentState - The current execution state of the scheduled script
 * @param {object} payload - The payload that needs to update or add the keys in the existing script state
 * @returns {{orderLoopCounter: number, orderSearchOffsetCounter: number}} (new state for the scheduled script)
 */
function incrementOrderLoopCounter(currentState , payload){
    //handling if script is rescheduling and items loop has finished
    if(currentState.scriptStatus == "RESCHEDULED" && currentState.orderLineItemsLoopCounter == 0){
        return {
            orderLoopCounter: 1 + currentState.orderLoopCounter,
            orderSearchOffsetCounter: 1 + currentState.orderSearchOffsetCounter
        };
    //handling if script is rescheduled and the items to iterate remain.
    }else if(currentState.scriptStatus == "RESCHEDULED" && currentState.orderLineItemsLoopCounter > 0){
        return {
            orderLoopCounter: currentState.orderLoopCounter,
            orderSearchOffsetCounter: currentState.orderSearchOffsetCounter
        };
    }else{
        //not rescheduling. simply increment the getOrder and process order loops
        return {
            orderLoopCounter: 1 + currentState.orderLoopCounter,
            orderSearchOffsetCounter: 1 + currentState.orderSearchOffsetCounter
        };
    }
}

/**
 * Change the state of the lineitem iterator when item has been processed
 *
 * @param currentState
 * @param payload
 * @returns {{orderLineItemsLoopCounter: number}}
 */
function incrementLineItemsCounter(currentState , payload){
    return {
        orderLineItemsLoopCounter: 1 + currentState.orderLineItemsLoopCounter
    };
}

/**
 * reset the line item iterator to zero when the iteration has completed for the current order.
 * @param currentState
 * @param payload
 * @returns {{orderLineItemsLoopCounter: number}}
 */

function reinitializeLineItemLoop(currentState,payload){
    return {
        orderLineItemsLoopCounter: 0
    };
}
/*******************************************************************************************/

/**
 * registering the state handling actions logic to the stateHelper (redux wrapper for NS)
 */
function registerAdditionalActions(){
    stateHelper.registerEventsForStateUpdate('INCREMENT_ORDER_COUNTER',incrementOrderLoopCounter);
    stateHelper.registerEventsForStateUpdate('INCREMENT_ORDER_LINEITEM_COUNTER',incrementLineItemsCounter);
    stateHelper.registerEventsForStateUpdate('RESET_LINEITEM_COUNTER',reinitializeLineItemLoop);
}

function getItemType(id){
    if(!id)
        return null;

    var type = "";
    var itemSearch = nlapiSearchRecord("item",null,
        [
            ["internalid","anyof",id]
        ],
        [
            new nlobjSearchColumn("type")
        ]
    );


    if(!!itemSearch && itemSearch.length>0){
        type = itemSearch[0].getRecordType();
    }

    return type;
}

function processLineItemsForSalesOrder(orderRec){
    var totalLines = parseInt(orderRec.getLineItemCount('item'));
    for (var i = stateHelper.currentState().orderLineItemsLoopCounter; i<totalLines ; i++){
        //do some processing on the lineitems;
        nlapiLogExecution('DEBUG','processLineItemsForSalesOrder >> processing LineItem', 'iterating item: '+ (parseInt(i) + 1).toString());
        var itemId = orderRec.getLineItemValue('item','item',parseInt(i) + 1);
        var itmType = getItemType(itemId);
        var itemRecord = nlapiLoadRecord(itmType,itemId);
        if(stateHelper.propagateState({type:"INCREMENT_ORDER_LINEITEM_COUNTER",payload:{}})){
            return;
        }
    }
    stateHelper.propagateState({type:"RESET_LINEITEM_COUNTER",payload:{}})
}

/**
 * do some processing on the SO record
 * @param id
 */
function loadAndProcessSalesOrder(id){
    var soRec = nlapiLoadRecord('salesorder',id);
    nlapiLogExecution('DEBUG','loadAndProcessSalesOrder >> processing salesorder', 'salesorder id : '+id);
    processLineItemsForSalesOrder(soRec);
}

function isDeployed() {
    var deps = nlapiSearchRecord('scriptdeployment', null, ['scriptid', 'is', nlapiGetContext().getDeploymentId()]);
    if (deps && deps.length > 0) {
        this.DeploymentInternalId = deps[0].getId();
    }

    return nlapiLookupField('scriptdeployment', this.DeploymentInternalId, 'isdeployed') == 'T';
}

/**
 * entry level function for the scheduled script
 */
function main(type){

    /*Initializes the script to the initial state if first run or sets the script from the state loaded from the param*/
    stateHelper.initializeScriptState({
        orderSearchOffsetCounter:0,
        orderLoopCounter:0,
        orderLineItemsLoopCounter:0,
        scriptStatus:"START"
    },"custscript_f3_redux_state_holder");

    nlapiLogExecution('DEBUG','state when script starts', JSON.stringify(stateHelper.currentState()));

    /*Register actions to the stateHelper for the scheduled script*/
    registerAdditionalActions();

    try{
        var ordersToProcess = getRecordsToProcess();

        for (var i=stateHelper.currentState().orderLoopCounter;i<ordersToProcess.length;i++){
            if(!isDeployed()) {
                nlapiLogExecution('DEBUG','breaking due to not deployed','');
                return;
            }
            nlapiLogExecution('DEBUG','state after each iteration ', JSON.stringify(stateHelper.currentState()));
            loadAndProcessSalesOrder(ordersToProcess[i].getId());

            /**update the script state using action type and payload for the new state*/
            /**The action used in propagate state needs to be registered first*/

            if(stateHelper.propagateState({type:"INCREMENT_ORDER_COUNTER",payload:{}})){
                /**rescheduling the script by setting the store state*/
                return stateHelper.storeStateForRescheduling();
                nlapiLogExecution('DEBUG','state after rescheduling', JSON.stringify(stateHelper.currentState()));
            };
        }
    }catch(e){
        nlapiLogExecution('DEBUG','EXCEPTION OCCURED !!! ',e.message);
    }


}