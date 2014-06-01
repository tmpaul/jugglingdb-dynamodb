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
    //Call splitSlice to chunk the data
    var chunkedData = this.splitSlice(data[key], N);
    //Assign each element in the chunked data
    //to data.
    for (counter = 1; counter <= N; counter++) {
      var chunkKeyName = key + "-" + String(counter);
      // DynamoDB does not allow empty strings.
      // So filter out empty strings
      if (chunkedData[counter - 1] !== "") {
        data[chunkKeyName] = chunkedData[counter - 1];
      }
    }
    // Finally delete data[key]
    delete data[key];
    return data;
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
  }
}