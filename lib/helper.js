var async = require('async');
var colors = require('colors');
module.exports = {
  TypeLookup: function TypeLookup(typestring) {
    if (typestring === "string") {
      return 'S';
    } else if (typestring === "number") {
      return 'N';
    } else if (typestring === "binary") {
      return 'B';
    } else if (typestring === "boolean") {
      return 'S';
    } else if (typestring === "date") {
      return 'N';
    }
  },

  ReverseTypeLookup: function ReverseTypeLookup(typestring) {
    if (typestring === 'S') {
      return "string";
    } else if (typestring === 'N') {
      return "number";
    } else if (typestring === 'B') {
      return "binary";
    } else {
      return "string";
    }
  },
  /**
   * Helper function to convert a regular model
   * object to DynamoDB JSON notation.
   *
   * e.g 20 will be returned as { 'N': '20' }
   * & `foobar` will be returned as { 'S' : 'foobar' }
   *
   * Usage
   * - objToDB(20);
   * - objToDB("foobar");
   * ----------------------------------------------
   *
   * @param  {object} data to be converted
   * @return {object} DynamoDB compatible JSON object
   */
  objToDB: function objToDB(data) {
    var tempObj = {};
    var elementType = this.TypeLookup(typeof (data));
    tempObj[elementType] = data.toString();
    return tempObj;
  },
  /**
   * Helper function to convert a DynamoDB type
   * object into regular model object.
   *
   * e.g { 'N': '20' } will be returned as 20
   * & { 'S' : 'foobar' }  will be returned as `foobar`
   *
   * @param  {object} data
   * @return {object}
   */
  objFromDB: function objFromDB(data) {
    var tempObj;
    for (var key in data) {
      if (data.hasOwnProperty(key)) {
        var elementType = this.ReverseTypeLookup(key);
        if (elementType === "string") {
          tempObj = data[key];
        } else if (elementType === "number") {
          tempObj = Number(data[key]);
        }
      }
    }
    return tempObj;
  },
  /**
   * Slice a string into N different strings
   * @param  {String} str : The string to be chunked
   * @param  {Number} N   : Number of pieces into which the string must be broken
   * @return {Array}  Array of N strings
   */
  splitSlice: function splitSlice(str, N) {
    var ret = [];
    var strLen = str.length;
    if (strLen === 0) {
      return ret;
    } else {
      var len = Math.floor(strLen / N) + 1;
      var residue = strLen % len;
      var offset = 0;
      for (var index = 1; index < N; index++) {
        var subString = str.slice(offset, len + offset);
        ret.push(subString);
        offset = offset + len;
      }
      ret.push(str.slice(offset, residue + offset));
      return ret;
    }
  },
  /**
   * Chunks data and assigns it to the data object
   * @param {Object} data : Complete data object
   * @param {String} key  : Attribute to be chunked
   * @param {Number} N    : Number of chunks
   */
  ChunkMe: function ChunkMe(data, key, N) {
    var counter;
    var newData = [];
    //Call splitSlice to chunk the data
    var chunkedData = this.splitSlice(data[key], N);
    //Assign each element in the chunked data
    //to data.
    for (counter = 1; counter <= N; counter++) {
      var tempObj = {};
      var chunkKeyName = key;
      // DynamoDB does not allow empty strings.
      // So filter out empty strings
      if (chunkedData[counter - 1] !== "") {
        tempObj[chunkKeyName] = chunkedData[counter - 1];
        newData.push(tempObj);
      }
    }
    delete data[key];
    // Finally delete data[key]
    return newData;
  },
  /**
   * Builds back a chunked object stored in the
   * database to its normal form
   * @param {Object} data : Object to be rebuilt
   * @param {String} key  : Name of the field in the object
   */
  BuildMeBack: function BuildMeBack(data, breakKeys) {
    var counter;
    var currentName;
    var finalObject;
    breakKeys.forEach(function (breakKey) {
      counter = 1;
      finalObject = "";
      for (var key in data) {
        currentName = breakKey + "-" + String(counter);
        if (data[currentName]) {
          finalObject = finalObject + data[currentName];
          delete data[currentName];
          counter++;
        }
      }
      data[breakKey] = finalObject;
    });
    return data;
  },
  /*
  See http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
   */
  UUID: function UUID() {
    var uuid ='xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
    });
    return uuid;
  },

  GetMyChildrenBack: function GetMyChildrenBack(data, model, pKey, breakables, dynamodb, OuterCallback) {
    // Iterate over breakables. Query using data's hashKey
    var hashKeyAttribute = model.toLowerCase() + "#" + pKey;
    /*
    Use async series to fetch each breakable attribute in series.
     */
    async.mapSeries(breakables, function (breakable, callback) {
      var params = {};
      params.KeyConditions = {};
      params.KeyConditions[hashKeyAttribute] = {};
      params.KeyConditions[hashKeyAttribute].ComparisonOperator = 'EQ';
      params.KeyConditions[hashKeyAttribute].AttributeValueList = [];
      params.KeyConditions[hashKeyAttribute].AttributeValueList.push({
        'S': String(data[pKey])
      });
      params.TableName = model + "_" + breakable;
      dynamodb.query(params, function (err, res){
        if (err) {
          return callback(err,null);
        } else {
          var callbackData = "";
          res.Items.forEach(function (item) {
            callbackData = callbackData + item[breakable]['S'];
          });
          callback(null,callbackData);
        }
      }.bind(this));
    }, function (err, results) {
       if (err) {
        OuterCallback(err, null);
       } else {
         // results array will contain an array of built back attribute values.
         for (i = 0; i < results.length; i++) {
            data[breakables[i]] = results[i];            
         }
         OuterCallback(null, data);
      }
    }.bind(this));


  }
}
