/**
 * Module dependencies
 */
var AWS = require('aws-sdk');
var colors = require('colors');
var helper = require('./helper.js');
var async = require('async');
var EventEmitter = require('events').EventEmitter;
var winston = require('winston');
var util = require('util');
// Winston logger configuration
var logger = new(winston.Logger)({
  transports: [
  new(winston.transports.Console)({
    colorize: true,
  })/*
   new(winston.transports.File)({ 
    filename: 'logs/dynamodb.log',
    maxSize: 1024 * 1024 *5
  })*/
  ]
});

function DynamoDB(s, schema, callback) {
  if (!AWS) {
    throw new Error("AWS SDK not installed. Please run npm install aws-sdk");
  }
  var i, n;
  this.name = 'dynamodb';
  this._models = {};
  this._tables = {};
  this._attributeSpecs = [];
  // Connect to dynamodb server
  var dynamodb;
  // Try to read accessKeyId and secretAccessKey from environment variables
  if ((process.env.AWS_ACCESS_KEY_ID !== undefined) && (process.env.AWS_SECRET_ACCESS_KEY !== undefined)) {
    logger.log("debug","Credentials selected from environment variables");
    AWS.config.update({
      region: s.region,
      maxRetries: s.maxRetries
    });
    dynamodb = new AWS.DynamoDB();
  } else {
      logger.log("warn", "Credentials not found in environment variables");
      try {
        AWS.config.loadFromPath('credentials.json');
        logger.log("info", "Loading credentials from file");
        dynamodb = new AWS.DynamoDB();
      } catch (e) {
        logger.log("warn", "Cannot find credentials file");
        logger.log("info", "Using settings from schema");
        AWS.config.update({
          accessKeyId: s.accessKeyId,
          secretAccessKey: s.secretAccessKey,
          region: s.region,
          maxRetries : s.maxRetries
        });
      dynamodb = new AWS.DynamoDB({
        endpoint: new AWS.Endpoint('http://' + s.host + ':' + s.port)
      });
    }
  }

  schema.adapter = dynamodb;
  this.client = dynamodb; // Used by instance methods
  this.emitter = new EventEmitter();
  callback();
}

exports.initialize = function initializeSchema(schema, callback) {
  // s stores the schema settings
  var s = schema.settings;
  if (schema.settings) {
    s.host = schema.settings.host || "localhost";
    s.port = schema.settings.port || 8000;
    s.region = schema.settings.region || "ap-southeast-1";
    s.accessKeyId = schema.settings.accessKeyId || "fake";
    s.secretAccessKey = schema.settings.secretAccessKey || "fake";
    s.maxRetries = schema.settings.maxRetries || 0;
  } else {
    s.region = "ap-southeast-1";
  }
  logger.transports.console.level = schema.settings.logLevel || 'debug';
  logger.info("Initializing dynamodb adapter");
  schema.adapter = new DynamoDB(s, schema, callback);
};


/*
  Assign Attribute Definitions
  and KeySchema based on the keys
*/
function AssignKeys(name, type, settings) {
  var attr = {};
  var tempString;
  var aType;
  
  attr.keyType = name.keyType;
  tempString = (name.type).toString();
  aType = tempString.match(/\w+(?=\(\))/)[0];
  aType = aType.toLowerCase();
  attr.attributeType = helper.TypeLookup(aType);
  return attr;
}

/**
  Record current time in milliseconds
*/
function startTimer() {
  timeNow = new Date().getTime();
  return timeNow;
}
/**
  Given start time, return a string containing time difference in ms
*/
function stopTimer(timeStart) {
  return "[" + String(new Date().getTime() - timeStart) + " ms]";
}
/**
 * Create a table based on hashkey, rangekey specifications
 * @param  {object} dynamodb        : adapter
 * @param  {object} tableParams     : KeySchema & other attrs
 * @param {Boolean} tableStatusWait : If true, wait for table to become active
 * @param {Number} timeInterval     : Check table status after `timeInterval` milliseconds
 * @param {function} callback       : Callback function
 */
function createTable(dynamodb, tableParams, tableStatusWait, timeInterval, callback) {
  var tableExists = false;
  var tableStatusFlag = false;
  dynamodb.listTables(function (err, data) {
    if (err || !data) {
      logger.log("error", "-------Error while fetching tables from server. Please check your connection settings & AWS config--------");
      callback(err, null);
      return;
    } else {
      // Boolean variable to check if table already exists.
      var existingTableNames = data.TableNames;
      existingTableNames.forEach(function (existingTableName) {
        if (tableParams.TableName === existingTableName) {
          tableExists = true;
          logger.log("info", "TABLE %s FOUND IN DATABASE", existingTableName);
        }
      });
      // If table exists do not create new table
      if (tableExists === false) {
        // DynamoDB will throw error saying table does not exist
        logger.log("info", "CREATING TABLE: %s IN DYNAMODB", tableParams.TableName);
        dynamodb.createTable(tableParams, function (err, data) {
          if (err || !data) {
            callback(err, null);
            return;
          } else {
            logger.log("info", "TABLE CREATED");
            if (tableStatusWait) {
              
              async.whilst(function () {
                return !tableStatusFlag;

              }, function (innerCallback) {
                logger.log("info", "Checking Table Status");
                dynamodb.describeTable({
                  TableName: tableParams.TableName
                }, function (err, tableData) {
                  if (err) {
                    innerCallback(err);
                  } else if (tableData.Table.TableStatus === "ACTIVE") {
                    logger.log("info", "Table Status is `ACTIVE`");
                    tableStatusFlag = true;
                    innerCallback(null);
                  } else {
                    setTimeout(innerCallback, timeInterval);
                  }
                });

              }, function (err) {
                if (err) {
                  callback(err, null);
                } else {
                  callback(null, "active");
                }
              }.bind(this));
            }
          } // successful response
        }.bind(this));
      } else {
        callback(null, "done");
      }
    }
  });
}





// Check if object is empty
function isEmpty(obj) {
    var hasOwnProperty = Object.prototype.hasOwnProperty;
    // null and undefined are "empty"
    if (obj === null) return true;

    // Assume if it has a length property with a non-zero value
    // that that property is correct.
    if (obj.length > 0)    return false;
    if (obj.length === 0)  return true;

    // Otherwise, does it have any properties of its own?
    // Note that this doesn't handle
    // toString and valueOf enumeration bugs in IE < 9
    for (var key in obj) {
        if (hasOwnProperty.call(obj, key)) return false;
    }

    return true;
}


/**
 * Define schema and create table with hash and range keys
 * @param  {object} descr : description specified in the schema
 */
DynamoDB.prototype.define = function (descr) {
  var timeStart = startTimer();
  if (!descr.settings) descr.settings = {};
  var modelName = descr.model.modelName;
  var emitter = this.emitter;
  this._models[modelName] = descr;
  // Set Read & Write Capacity Units
  this._models[modelName].ReadCapacityUnits = descr.settings.ReadCapacityUnits || 5;
  this._models[modelName].WriteCapacityUnits = descr.settings.WriteCapacityUnits || 10;

  var timeInterval, tableStatusWait;
  // Wait for table to become active?
  if (descr.settings.tableStatus) {
    tableStatusWait = descr.settings.tableStatus.waitTillActive;
    if (tableStatusWait === undefined) {
      tableStatusWait = true;
    }
      timeInterval = descr.settings.tableStatus.timeInterval || 5000;
  } else {
      tableStatusWait = true;
      timeInterval = 5000;
  }

  // Create table now with the hash and range index.
  var properties = descr.properties;
  // Iterate through properties and find index
  var tableParams = {};
  tableParams.AttributeDefinitions = [];
  tableParams.KeySchema = [];
  this._models[modelName].breakables = [];
  this._models[modelName].breakValues = [];
  this._models[modelName].splitSizes = [];
  this._attributeSpecs[modelName] = {};
  // Temporary object to store read and write capacity units for breakable attrs
  var rcus = {};
  var wcus = {};
  /*
    Build KeySchema for the table based on schema definitions.
   */
  for (var key in properties) {
    // Assign breakers, limits or whatever other properties
    // are specified first
    // Store the type of attributes in _attributeSpecs. This is
    // quite helpful to do Date & Boolean conversions later
    // on.
    var tempString = (properties[key].type).toString();
    var aType = tempString.match(/\w+(?=\(\))/)[0];
    aType = aType.toLowerCase();
    this._attributeSpecs[modelName][key] = aType;

    if (properties[key].sharding === true) {
        this._models[modelName].breakables.push(key);
        this._models[modelName].breakValues.push(0);

        var splitterString = properties[key].splitter || "63kb";
        var splitterSize = Number(splitterString.match(/\d+(?=kb)/));
        this._models[modelName].splitSizes.push(splitterSize);
        logger.log("debug", "Attribute", key, "split by size: ", splitterSize, "kb");

        if (properties[key].read !== undefined) {
          rcus[key] = Number(properties[key].read);
        } else {
          rcus[key] = this._models[modelName].ReadCapacityUnits;
        }
        if (properties[key].write !== undefined) {
          wcus[key] = Number(properties[key].write);
        } else {
          wcus[key] = this._models[modelName].WriteCapacityUnits;
        }
      
    }
    // Check if UUID is set to be true for HASH KEY attribute
    if (properties[key].keyType === "hash") {
      if (properties[key].uuid === true) {
        if (key !== 'id') {
          throw new Error("UUID generation is only allowed for attribute name id");
        } else {
          this._models[modelName].hashKeyUUID = true;
          logger.log("debug", "Hash key UUID generation: TRUE");
        }
        
      } else {
        this._models[modelName].hashKeyUUID = false;
      }
    }
    // Following code is applicable only for keys
    if (properties[key].keyType !== undefined) {
      var attrs = AssignKeys(properties[key]);
      // The keys have come! Add to tableParams
      // Add Attribute Definitions
      // HASH primary key?
      if (attrs.keyType === "hash") {
        this._models[modelName].hashKey = key;
        logger.log("debug", "HASH KEY:",key);
        tableParams.KeySchema.push({
          AttributeName: key,
          KeyType: 'HASH'
        });
        tableParams.AttributeDefinitions.push({
          AttributeName: key,
          AttributeType: attrs.attributeType
        });
      }
      // Range primary key?
      if (attrs.keyType === "range") {
        this._models[modelName].rangeKey = key;
        logger.log("debug", "RANGE KEY:",key);
        tableParams.KeySchema.push({
          AttributeName: key,
          KeyType: 'RANGE'
        });
        tableParams.AttributeDefinitions.push({
          AttributeName: key,
          AttributeType: attrs.attributeType
        });
      }
      // Composite virtual primary key?
      if (attrs.keyType === "pk") {
        this._models[modelName].pKey = key;
        this._models[modelName].pkSeparator = properties[key].separator || "--x--";
      }
    }
  }
  tableParams.ProvisionedThroughput = {
    ReadCapacityUnits: this._models[modelName].ReadCapacityUnits,
    WriteCapacityUnits: this._models[modelName].WriteCapacityUnits
  };
  logger.log("debug", "Read Capacity Units:",tableParams.ProvisionedThroughput.ReadCapacityUnits);
  logger.log("debug", "Write Capacity Units:",tableParams.ProvisionedThroughput.WriteCapacityUnits);
  
  if ((this._models[modelName].rangeKey !== undefined) && (this._models[modelName].pKey !== undefined)) {
    if (this._models[modelName].pKey !== 'id') {
      throw new Error("Primary Key must be named `id`");
    }
  }
  if ((this._models[modelName].rangeKey !== undefined) && (this._models[modelName].pKey === undefined)) {
    throw new Error("Range key is present, but primary key not specified in schema");
  }

  /*
    JugglingDB expects an id attribute in return even if a hash key is not specified. Hence
    if hash key is not defined in the schema, create an attribute called id, set it as hashkey.
   */
  if ((this._models[modelName].hashKey === undefined) && (properties.id === undefined)) {
    this._models[modelName].hashKey = 'id';
    this._models[modelName].hashKeyUUID = true;
    this._attributeSpecs[modelName][this._models[modelName].hashKey] = "string";
    tableParams.KeySchema.push({
      AttributeName: 'id',
      KeyType: 'HASH'
    });
    tableParams.AttributeDefinitions.push({
      AttributeName: 'id',
      AttributeType:  'S'
    });
  }
  
  // If there are breakable attrs with sharding set to true, create the
  // extra tables now
  var _dynamodb = this.client;
  var breakableAttributes = this._models[modelName].breakables;
  var attributeSpecs = this._attributeSpecs[modelName];
  var ReadCapacityUnits = this._models[modelName].ReadCapacityUnits;
  var WriteCapacityUnits = this._models[modelName].WriteCapacityUnits;
  var hashKey = this._models[modelName].hashKey;
  var pKey = this._models[modelName].pKey;

  
  // Assign table name
  tableParams.TableName = descr.settings.table || modelName;
  logger.log("debug", "Table Name:", tableParams.TableName);
  // Add this to _tables so that instance methods can use it.
  this._tables[modelName] = tableParams.TableName;
  // Create main table function

  createTable(_dynamodb, tableParams, tableStatusWait, timeInterval, function (err, data) {
    if (err || !data) {
      var tempString = "while creating table: " + tableParams.TableName + " => " + err.message.toString();
      throw new Error(tempString);
    } else {
      async.mapSeries(breakableAttributes, function (breakableAttribute, callback) {
        logger.log("debug", "Sharding attribute:",breakableAttribute);
        var shardParams = {};
        shardParams.KeySchema = [];
        shardParams.AttributeDefinitions = [];
        if (pKey !== undefined) {
          shardParams.KeySchema.push({
            AttributeName: modelName.toLowerCase() + "#" + pKey,
            KeyType: 'HASH'
          });
          logger.log("debug", "HASH KEY:",modelName.toLowerCase() + "#" + pKey);
          shardParams.AttributeDefinitions.push({
            AttributeName: modelName.toLowerCase() + "#" + pKey,
            AttributeType: 'S'
          });
        } else {
          shardParams.KeySchema.push({
            AttributeName: modelName.toLowerCase() + "#" + hashKey,
            KeyType: 'HASH'
          });
          logger.log("debug", "HASH KEY:",modelName.toLowerCase() + "#" + hashKey);
          shardParams.AttributeDefinitions.push({
            AttributeName: modelName.toLowerCase() + "#" + hashKey,
            AttributeType: 'S'
          });
        }

        shardParams.KeySchema.push({
          AttributeName: breakableAttribute + "#ID",
          KeyType: 'RANGE'
        });
        logger.log("debug", "RANGE KEY:",breakableAttribute + "#ID");
        shardParams.AttributeDefinitions.push({
          AttributeName: breakableAttribute + "#ID",
          AttributeType: 'N'
        });
        shardParams.TableName = modelName + "_" + breakableAttribute;
        shardParams.ProvisionedThroughput = {
          ReadCapacityUnits: rcus[breakableAttribute],
          WriteCapacityUnits: wcus[breakableAttribute]
        };
        logger.log("debug", "Read Capacity Units:",shardParams.ProvisionedThroughput.ReadCapacityUnits);
        logger.log("debug", "Write Capacity Units:",shardParams.ProvisionedThroughput.WriteCapacityUnits);
        // create shardParams
        createTable(_dynamodb, shardParams, tableStatusWait, timeInterval, callback);
      }, function (err, results) {
         emitter.emit("created");
         emitter.emit("created-" + modelName.toLowerCase());
         return;
      }.bind(this));
    }
  });
logger.log("info", "Defining model: ",modelName, stopTimer(timeStart).bold.cyan);
};
/**
 * Creates a DynamoDB compatible representation
 * of arrays, objects and primitives.
 * @param {object} data: Object to be converted
 * @return {object} DynamoDB compatible JSON
 */
function DynamoFromJSON(data) {
  var obj;
  /*
    If data is an array, loop through each member
    of the array, and call objToDB on the element
    e.g ["someword",20] --> [ {'S': 'someword'} , {'N' : '20'}]
   */
  if (data instanceof Array) {
    obj = [];
    data.forEach(function (dataElement) {
      // If string is empty, assign it as
      // "null".
      if (dataElement === "") {
        dataElement = "empty";
      }
      if (dataElement instanceof Date) {
        dataElement = Number(dataElement);
      }
      obj.push(helper.objToDB(dataElement));
    });
  }
  /*
    If data is an object, loop through each member
    of the object, and call objToDB on the element
    e.g { age: 20 } --> { age: {'N' : '20'} }
   */
  else if ((data instanceof Object) && (data instanceof Date !== true)) {
    obj = {};
    for (var key in data) {
      if (data.hasOwnProperty(key)) {
        // If string is empty, assign it as
        // "null".
        if (data[key] === undefined) {
          data[key] = "undefined";
        }
        if (data[key] === null) {
          data[key] = "null";
        }
        if (data[key] === "") {
          data[key] = "empty";
        }
        // If Date convert to number
        if (data[key] instanceof Date) {
          data[key] = Number(data[key]);
        }
        obj[key] = helper.objToDB(data[key]);
      }
    }
    /*
    If data is a number, or string call objToDB on the element
    e.g 20 --> {'N' : '20'}
   */
  } else {

    // If string is empty, assign it as
    // "empty".
    if (data === null) {
      data = "null";
    }
    if (data === undefined) {
      data = "undefined";
    }
    if (data === "") {
      data = "empty";
    }
    // If Date convert to number
    if (data instanceof Date) {
      data = Number(data);
    }
    obj = helper.objToDB(data);
  }
  return obj;
}

function JSONFromDynamo(data, attributeSpecs) {
  var obj;
  if (data instanceof Object) {
    obj = {};
    for (var key in data) {
      if (data.hasOwnProperty(key)) {
        obj[key] = helper.objFromDB(data[key]);
        if (obj[key] === "undefined") {
          obj[key] = undefined;
        }
        if (obj[key] === "null") {
          obj[key] = null;
        }
        // If string and ==="null", put back as empty ""
        if ((attributeSpecs[key] === "string") && (obj[key] === "empty")) {
          obj[key] = "";
        }
        if ((attributeSpecs[key] === "date") && (data[key] !== "null") && (data[key] !== "undefined")) {
          obj[key] = new Date(obj[key]);
        }
        if ((attributeSpecs[key] === "boolean") && (data[key] !== "null") && (data[key] !== "undefined")) {
          obj[key] = obj[key] === "true";
        }
      }
    }
  }
  return obj;
}
/**
 * Converts jugglingdb operators like 'gt' to DynamoDB form 'GT'
 * @param {string} DynamoDB comparison operator
 */
function OperatorLookup(operator) {
  if (operator === "inq") {
    operator = "in";
  }
  return operator.toUpperCase();
}

DynamoDB.prototype.defineProperty = function (model, prop, params) {
  this._models[model].properties[prop] = params;
};

DynamoDB.prototype.tables = function (name) {
  if (!this._tables[name]) {
    this._tables[name] = name;
  }
  return this._tables[name];
};
/**
 * Create a new item or replace/update it if it exists
 * @param  {object}   model
 * @param  {object}   data   : key,value pairs of new model object
 * @param  {Function} callback
 */
DynamoDB.prototype.create = function (model, data, callback) {
  var timerStart = startTimer();
  var hashKey = this._models[model].hashKey;
  var rangeKey = this._models[model].rangeKey;
  var pkSeparator = this._models[model].pkSeparator;
  var pKey = this._models[model].pKey;
  var err;
  // If jugglingdb defined id is undefined, and it is not a
  // hashKey or a primary key , then delete it.
  if ((data.id === undefined) && (hashKey !== 'id')) {
    delete data.id;
  }
  // If some key is a hashKey, check if uuid is set to true. If yes, call the
  // UUID() function and generate a unique id.
  if (this._models[model].hashKeyUUID === true) {
    data[hashKey] = helper.UUID();
  }
  var originalData = {};
  // Copy all attrs from data to originalData
  for (var key in data) {
    originalData[key] = data[key];
  }

  if (data[hashKey] === undefined) {
    err = new Error("Hash Key `" + hashKey + "` is undefined.");
    callback(err, null);
    return;
  }
  if (data[hashKey] === null) {
    err = new Error("Hash Key `" + hashKey + "` cannot be NULL.");
    callback(err, null);
    return;
  }
  // If pKey is defined, range key is also present.
  if (pKey !== undefined) {
    if ((data[rangeKey] === null) || (data[rangeKey] === undefined)) {
      err = new Error("Range Key `" + rangeKey + "` cannot be null or undefined.");
      callback(err, null);
      return;
    } else {
      data[pKey] = String(data[hashKey]) + pkSeparator + String(data[rangeKey]);
      originalData[pKey] = data[pKey];
    }
  }

  var queryString = "CREATE ITEM IN TABLE " + this.tables(model);
  var tableParams = {};
  tableParams.TableName = this.tables(model);
  tableParams.ReturnConsumedCapacity = "TOTAL";
  /* Data is the original object coming in the body. In the body
     if the data has a key which is breakable, it must be chunked
     into N different attrs. N is specified by the breakValue[key]
  */
  var breakableAttributes = this._models[model].breakables;
  var breakableValues = this._models[model].breakValues;
  var splitSizes = this._models[model].splitSizes;
  var attributeSpecs = this._attributeSpecs[model];
  var outerCounter = 0;
  var chunkedData = {};
  var dynamo = this.client;
  async.mapSeries(breakableAttributes, function (breakableAttribute, OuterCallback) {
    /*
      Handle empty, null, undefined strings
     */
    if(data[breakableAttribute] === null && attributeSpecs[breakableAttribute] === "string") {
      data[breakableAttribute] = "null";
    }
    if(data[breakableAttribute] === undefined && attributeSpecs[breakableAttribute] === "string") {
      data[breakableAttribute] = "undefined";
    }
    if(data[breakableAttribute] === "" && attributeSpecs[breakableAttribute] === "string") {
      data[breakableAttribute] = "empty";
    }
    /*
    ChunkMe will take the data, key and the break count
    and return with new attrs appended serially from
    1 to break count. If N is specified as 0, then N is
    automatically assigned based on the size of the string
   */
    var N;
    var dataSize = Buffer.byteLength(data[breakableAttribute], 'utf8');
    // Check if splitter is defined
    if (splitSizes[outerCounter] !== undefined) {
      N = Math.ceil(dataSize / (splitSizes[outerCounter] * 1024));
    }
    logger.log("debug", "Attribute", breakableAttribute, "Datasize:", dataSize, "bytes", "No. of chunks:", N);
    chunkedData = helper.ChunkMe(data, breakableAttribute, N);
    // Write chunkedData to database
    // Use async series
    var innerCounter = 0;
    var batchWriteParams = {};
    var tableName = model + "_" + breakableAttribute;
    batchWriteParams["RequestItems"] = {};
    batchWriteParams["RequestItems"][tableName] = [];
    async.mapSeries(chunkedData, function (chunked, innerCallback) {

      // Each element in this array will be a put request.
      var chunkParamElement = {};
      chunkParamElement["PutRequest"] = {};
      chunkParamElement["PutRequest"].Item = {};

      var itemParams = {};
      var hashKeyAttribute;
      if (pKey !== undefined) {
        hashKeyAttribute = String(model).toLowerCase() + "#" + pKey;
        chunked[hashKeyAttribute] = String(data[pKey]);
      } else {
        hashKeyAttribute = String(model).toLowerCase() + "#" + hashKey;
        chunked[hashKeyAttribute] = String(data[hashKey]);
      }
      var rangeKeyAttribute = String(breakableAttribute) + "#ID";
      chunked[rangeKeyAttribute] = innerCounter + 1;

      /**
       * Item Params now holds the object in DYNAMO JSON format.
       * 
       */
      itemParams = DynamoFromJSON(chunked);
      chunkParamElement["PutRequest"].Item = itemParams;
      innerCounter++;
      innerCallback(null, chunkParamElement);

    }, function (err, innerResults) {
       if (err) {
        OuterCallback(err, null);
       } else {
        logger.log("debug", "ASSEMBLY COMPLETE");
        // innerResults consist of an array of objects with PutRequest in each of the element.
        batchWriteParams["RequestItems"][tableName] = innerResults;
        // Write to database now.
        dynamo.batchWriteItem(batchWriteParams, function (batchErr, batchResults) {
          if (batchErr) {
            OuterCallback(batchErr, null);
          } else {
            outerCounter++;
            OuterCallback(null, outerCounter);
          }
        });
       }
    }.bind(this));

  }, function (err, results) {
      if (err) {
        callback(err, null);
        return;
      } else {
        var tempString = "INSERT ITEM INTO TABLE: " + tableParams.TableName;
        logger.log("debug", tempString);
        if (pKey !== undefined) {
          delete data[pKey];
        }
        tableParams.Item = DynamoFromJSON(data);
        dynamo.putItem(tableParams, function (err, res) {
          if (err || !res) {
            callback(err, null);
            return;
          } else {
            if (res.ConsumedCapacity && res.ConsumedCapacity.CapacityUnits) {
              var cuString = "Consumed Units: " + res.ConsumedCapacity.CapacityUnits.toString();
              logger.log("debug", cuString.magenta);
            }
            logger.log("info", queryString.blue, stopTimer(timerStart).bold.cyan);
            if (pKey !== undefined) {
              originalData.id = originalData[pKey];
              callback(null, originalData.id);
              return;
            } else {
              originalData.id = originalData[hashKey];
              callback(null, originalData.id);
              return;
            }
            
          }
        }.bind(this));
      }
  }.bind(this));
};
/**
 * Function that performs query operation on dynamodb
 * @param  {object} model
 * @param  {object} filter             : Query filter
 * @param  {Number/String} hashKey     : Hash Key
 * @param  {object} rangeKey           : Range Key
 * @param  {String} queryString        : The query string (used for console logs)
 * @param  {Number} timeStart          : Start time of query operation in milliseconds
 * @return {object}                    : Final query object to be sent to dynamodb
 */
function query(model, filter, hashKey, rangeKey, queryString, timeStart) {
  // Table parameters to do the query/scan
  var tableParams = {};
  // Define the filter if it does not exist
  if (!filter) {
    filter = {};
  }
  // Initialize query as an empty object
  var queryObj = {};
  // Construct query for amazon DynamoDB
  tableParams.KeyConditions = {};
  // Set queryfileter to empty object
  tableParams.QueryFilter = {};
  // If a where clause exists in the query, extract
  // the conditions from it.
  if (filter.where) {
    queryString = queryString + " WHERE ";
    for (var key in filter.where) {
      var condition = filter.where[key];
      // If condition is of type object, obtain key
      // and the actual condition on the key
      // In jugglingdb, `where` can have the following
      // forms.
      // 1) where : { key: value }
      // 2) where : { startTime : { gt : Date.now() } }
      // 3) where : { someKey : ["something","nothing"] }
      // condition now holds value in case 1),
      //  { gt: Date.now() } in case 2)
      // ["something, "nothing"] in case 3)
      /*
        If key is of hash or hash & range type,
        we can use the query function of dynamodb
        to access the table. This saves a lot of time
        since it does not have to look at all records
      */
      var insideKey = null;
      if (condition && condition.constructor.name === 'Object') {
        insideKey = Object.keys(condition)[0];
        condition = condition[insideKey];

        logger.log("debug","Condition Type => Object", "Operator", insideKey, "Condition Value:", condition);
        // insideKey now holds gt and condition now holds Date.now()
        queryObj[key] = {
          operator: OperatorLookup(insideKey),
          attrs: condition
        };
      } else if (condition && condition.constructor.name === "Array") {
        logger.log("debug", "Condition Type => Array", "Opearator", "IN", "Condition Value:", condition);
        queryObj[key] = {
          operator: 'IN',
          attrs: condition
        };
      } else {
        logger.log("debug", "Condition Type => Equality", "Condition Value:", condition);
        queryObj[key] = {
          operator: 'EQ',
          attrs: condition
        };
      }
      if (key === hashKey) {
        // Add hashkey eq condition to keyconditions
        tableParams.KeyConditions[key] = {};
        tableParams.KeyConditions[key].ComparisonOperator = queryObj[key].operator;
        // For hashKey only 'EQ' operator is allowed. Issue yellow error. DB will
        // throw a red error.
        if (queryObj[key].operator !== 'EQ') {
          var errString = "Warning: Only equality condition is allowed on HASHKEY";
          logger.log("warn", errString.yellow);
        }
        tableParams.KeyConditions[key].AttributeValueList = [];
        tableParams.KeyConditions[key].AttributeValueList.push(DynamoFromJSON(queryObj[key].attrs));
        queryString = queryString + " HASHKEY: `" + String(key) + "` " + String(queryObj[key].operator) + " `" + String(queryObj[key].attrs) + "`";
      } else if (key === rangeKey) {
        // Add hashkey eq condition to keyconditions
        tableParams.KeyConditions[key] = {};
        tableParams.KeyConditions[key].ComparisonOperator = queryObj[key].operator;
        tableParams.KeyConditions[key].AttributeValueList = [];

        var attrResult = DynamoFromJSON(queryObj[key].attrs);
        if (attrResult instanceof Array) {
          logger.log("debug", "Attribute Value list is an array");
          tableParams.KeyConditions[key].AttributeValueList = DynamoFromJSON(queryObj[key].attrs);
        } else {
          tableParams.KeyConditions[key].AttributeValueList.push(DynamoFromJSON(queryObj[key].attrs));
        }
        
        queryString = queryString + "& RANGEKEY: `" + String(key) + "` " + String(queryObj[key].operator) + " `" + String(queryObj[key].attrs) + "`";
      } else {
        tableParams.QueryFilter[key] = {};
        tableParams.QueryFilter[key].ComparisonOperator = queryObj[key].operator;
        tableParams.QueryFilter[key].AttributeValueList = [];


        var attrResult = DynamoFromJSON(queryObj[key].attrs);
        if (attrResult instanceof Array) {
          tableParams.QueryFilter[key].AttributeValueList = DynamoFromJSON(queryObj[key].attrs);
        } else {
          tableParams.QueryFilter[key].AttributeValueList.push(DynamoFromJSON(queryObj[key].attrs));
        }
        queryString = queryString + "& `" + String(key) + "` " + String(queryObj[key].operator) + " `" + String(queryObj[key].attrs) + "`";
      }
    }
  }
  queryString = queryString + ' WITH QUERY OPERATION ';
  logger.log("info", queryString.blue, stopTimer(timeStart).bold.cyan);
  return tableParams;
}

/**
 * Builds table parameters for scan operation
 * @param  {[type]} model       Model object
 * @param  {[type]} filter      Filter
 * @param  {[type]} queryString String that holds query operation actions
 * @param  {[type]} timeStart   start time of operation
 */
function scan(model, filter, queryString, timeStart) {
  // Table parameters to do the query/scan
  var tableParams = {};
  // Define the filter if it does not exist
  if (!filter) {
    filter = {};
  }
  // Initialize query as an empty object
  var query = {};
  // Set scanfilter to empty object
  tableParams.ScanFilter = {};
  // If a where clause exists in the query, extract
  // the conditions from it.
  if (filter.where) {
    queryString = queryString + " WHERE ";
    for (var key in filter.where) {
      var condition = filter.where[key];
      // If condition is of type object, obtain key
      // and the actual condition on the key
      // In jugglingdb, `where` can have the following
      // forms.
      // 1) where : { key: value }
      // 2) where : { startTime : { gt : Date.now() } }
      // 3) where : { someKey : ["something","nothing"] }
      // condition now holds value in case 1),
      //  { gt: Date.now() } in case 2)
      // ["something, "nothing"] in case 3)
      var insideKey = null;
      if (condition && condition.constructor.name === 'Object') {
        logger.log("debug","Condition Type => Object", "Operator", insideKey, "Condition Value:", condition);
        insideKey = Object.keys(condition)[0];
        condition = condition[insideKey];
        // insideKey now holds gt and condition now holds Date.now()
        query[key] = {
          operator: OperatorLookup(insideKey),
          attrs: condition
        };
      } else if (condition && condition.constructor.name === "Array") {
        logger.log("debug","Condition Type => Array", "Operator", insideKey, "Condition Value:", condition);
        query[key] = {
          operator: 'IN',
          attrs: condition
        };
      } else {
        logger.log("debug", "Condition Type => Equality", "Condition Value:", condition);
        query[key] = {
          operator: 'EQ',
          attrs: condition
        };
      }
      tableParams.ScanFilter[key] = {};
      tableParams.ScanFilter[key].ComparisonOperator = query[key].operator;
      tableParams.ScanFilter[key].AttributeValueList = [];
      var attrResult = DynamoFromJSON(query[key].attrs);

      if (attrResult instanceof Array) {
        logger.log("debug", "Attribute Value list is an array");
        tableParams.ScanFilter[key].AttributeValueList = DynamoFromJSON(query[key].attrs);
      } else {
        tableParams.ScanFilter[key].AttributeValueList.push(DynamoFromJSON(query[key].attrs));
      }
      

      queryString = queryString + "`" + String(key) + "` " + String(query[key].operator) + " `" + String(query[key].attrs) + "`";
    }
  }
  queryString = queryString + ' WITH SCAN OPERATION ';
  logger.log("info",queryString.blue , stopTimer(timeStart).bold.cyan);
  return tableParams;
}
/**
 *  Uses Amazon DynamoDB query/scan function to fetch all
 *  matching entries in the table.
 *
 */
DynamoDB.prototype.all = function all(model, filter, callback) {
  var timeStart = startTimer();
  var queryString = "GET ALL ITEMS FROM TABLE ";

  // If limit is specified, use it to limit results
  var limitObjects;
  if (filter && filter.limit) {
    if (typeof(filter.limit) !== "number") {
      callback(new Error("Limit must be a number in Model.all function"), null);
      return;
    }
    limitObjects = filter.limit;
  }


  // Order, default by hash key or id
  var orderByField;
  var args = {};
  if (this._models[model].rangeKey === undefined) {
    orderByField = this._models[model].hashKey;
    args[orderByField] = 1;
  } else {
    orderByField = 'id';
    args['id'] = 1;
  }
  // Custom ordering
  if (filter && filter.order) {
    var keys = filter.order;
    if (typeof keys === 'string') {
        keys = keys.split(',');
    }
    
    for (var index in keys) {
        var m = keys[index].match(/\s+(A|DE)SC$/);
        var keyA = keys[index];
        keyA = keyA.replace(/\s+(A|DE)SC$/, '').trim();
        orderByField = keyA;
        if (m && m[1] === 'DE') {
            args[keyA] = -1;
        } else {
            args[keyA] = 1;
        }
    }

  }

  // Skip , Offset
  var offset;
  if (filter && filter.offset) {
    if (typeof(filter.offset) !== "number") {
      callback(new Error("Offset must be a number in Model.all function"), null);
      return;
    }
    offset = filter.offset;
  } else if (filter && filter.skip) {
    if (typeof(filter.skip) !== "number") {
      callback(new Error("Skip must be a number in Model.all function"), null);
      return;
    }
    offset = filter.skip;
  }


  queryString = queryString + String(this.tables(model));
  // If hashKey is present in where filter, use query
  
  var hashKeyFound = false;
  if (filter && filter.where) {
    for (var key in filter.where) {
      if (key === this._models[model].hashKey) {
        hashKeyFound = true;
        logger.log("debug", "Hash Key Found, QUERY operation will be used");
      }
    }
  }

  // Check if an array of hash key values are provided. If yes, use scan.
  // Otherwise use query. This is because query does not support array of
  // hash key values
  if (hashKeyFound === true) {
    var condition = filter.where[this._models[model].hashKey];
      var insideKey = null;
      if ((condition && condition.constructor.name === 'Object') || (condition && condition.constructor.name === "Array")) {
        insideKey = Object.keys(condition)[0];
        condition = condition[insideKey];
        if (condition instanceof Array) {
          hashKeyFound = false;
          logger.log("debug", "Hash key value is an array. Using SCAN operation instead");
        }
      }
  }
  

  // If true use query function
  if (hashKeyFound === true) {
    var tableParams = query(model, filter, this._models[model].hashKey, this._models[model].rangeKey, queryString, timeStart);
    // Set table name based on model
    tableParams.TableName = this.tables(model);
    tableParams.ReturnConsumedCapacity = "TOTAL";

    var attributeSpecs = this._attributeSpecs[model];
    var LastEvaluatedKey = "junk";
    var queryResults = [];
    var dynamo = this.client;
    var finalResult = [];
    var hashKey = this._models[model].hashKey;
    var breakables = this._models[model].breakables;
    var client = this.client;
    var pKey = this._models[model].pKey;
    var pkSeparator = this._models[model].pkSeparator;
    var rangeKey = this._models[model].rangeKey;
    tableParams.ExclusiveStartKey = undefined;
    var modelObj = this._models[model];
    // If KeyConditions exist, then call DynamoDB query function
    if (tableParams.KeyConditions) {
      async.doWhilst( function(queryCallback) {
        logger.log("debug", "Query issued");
        dynamo.query(tableParams, function (err, res) {
        if (err || !res) {
          queryCallback(err);
        } else {
          // Returns an array of objects. Pass each one to
          // JSONFromDynamo and push to empty array
          LastEvaluatedKey = res.LastEvaluatedKey;
          if (LastEvaluatedKey !== undefined) {
            logger.log("debug", "LastEvaluatedKey found. Refetching..");
            tableParams.ExclusiveStartKey = LastEvaluatedKey;
          }
          if (res.ConsumedCapacity && res.ConsumedCapacity.CapacityUnits) {
            var cuString = "Consumed Units: " + res.ConsumedCapacity.CapacityUnits.toString();
            logger.log("debug", cuString.magenta);
          }
          
          async.mapSeries(res.Items, function (item, innerCallback) {
            var returnData = JSONFromDynamo(item, attributeSpecs);
            if ((rangeKey !== undefined) && (pKey !== undefined)) {
              returnData[pKey] = String(returnData[hashKey]) + pkSeparator + String(returnData[rangeKey]);
              if (breakables.length !== 0) {
                helper.GetMyChildrenBack(returnData, model, pKey, breakables, client, innerCallback);
                logger.log("debug", "Object rebuilt");
              } else {
                innerCallback(null, returnData);
              }
            } else {
              returnData.id = returnData[hashKey];
              if (breakables.length !== 0) {
                helper.GetMyChildrenBack(returnData, model, hashKey, breakables, client, innerCallback);
                logger.log("debug", "Object rebuilt");
              } else {
                innerCallback(null, returnData);
              }
            }
            
          }, function (err, items) {
            if (err) {
              queryCallback(err);
            } else {
              finalResult = items;
              queryResults = queryResults.concat(finalResult);
              queryCallback();
            }
            
          }.bind(this));
        }
      }.bind(this)); }, function() { return LastEvaluatedKey !== undefined; }, function (err){
         if (err) {
            callback(err, null);
          } else {

              if (offset !== undefined) {
                logger.log("debug", "Offset by",offset);
                queryResults = queryResults.slice(offset, limitObjects + offset);
              }

              if (limitObjects !== undefined) {
                logger.log("debug", "Limit by", limitObjects);
                queryResults = queryResults.slice(0, limitObjects);
              }

              logger.log("debug", "Sort by", orderByField, "Order:", args[orderByField] > 0 ? 'ASC' : 'DESC');
              queryResults = helper.SortByKey(queryResults, orderByField, args[orderByField]);

              if (filter && filter.include) {
                logger.log("debug", "Model includes", filter.include);
                modelObj.model.include(queryResults, filter.include, callback);
              } else {
                logger.log("debug", "Query results complete");
                callback(null, queryResults);
              }
         }
      }.bind(this));

    }
  } else {
    // Call scan function
    var tableParams = scan(model, filter, queryString, timeStart);
    tableParams.TableName = this.tables(model);
    tableParams.ReturnConsumedCapacity = "TOTAL";
    var attributeSpecs = this._attributeSpecs[model];
    var finalResult = [];
    var hashKey = this._models[model].hashKey;
    var breakables = this._models[model].breakables;
    var client = this.client;
    var pKey = this._models[model].pKey;
    var pkSeparator = this._models[model].pkSeparator;
    var rangeKey = this._models[model].rangeKey;
    var LastEvaluatedKey = "junk";
    var queryResults = [];
    var dynamo = this.client;
    tableParams.ExclusiveStartKey = undefined;
    var modelObj = this._models[model];
    // Scan DynamoDB table
      async.doWhilst( function(queryCallback) {
        dynamo.scan(tableParams, function (err, res) {
        if (err || !res) {
          queryCallback(err);
        } else {
          // Returns an array of objects. Pass each one to
          // JSONFromDynamo and push to empty array
          LastEvaluatedKey = res.LastEvaluatedKey;
          if (LastEvaluatedKey !== undefined) {
            tableParams.ExclusiveStartKey = LastEvaluatedKey;
          }
          if (res.ConsumedCapacity && res.ConsumedCapacity.CapacityUnits) {
            var cuString = "Consumed Units: " + res.ConsumedCapacity.CapacityUnits.toString();
            logger.log("debug", cuString.magenta);
          }
          
          async.mapSeries(res.Items, function (item, innerCallback) {
            var returnData = JSONFromDynamo(item, attributeSpecs);
            if ((rangeKey !== undefined) && (pKey !== undefined)) {
              returnData[pKey] = String(returnData[hashKey]) + pkSeparator + String(returnData[rangeKey]);
              if (breakables.length !== 0) {
                helper.GetMyChildrenBack(returnData, model, pKey, breakables, client, innerCallback);
                logger.log("debug", "Object rebuilt");
              } else {
                innerCallback(null, returnData);
              }
            } else {
              returnData.id = returnData[hashKey];
              if (breakables.length !== 0) {
                helper.GetMyChildrenBack(returnData, model, hashKey, breakables, client, innerCallback);
                logger.log("debug", "Object rebuilt");
              } else {
                innerCallback(null, returnData);
              }
            }
            
          }, function (err, items) {
            if (err) {
              queryCallback(err);
            } else {
              finalResult = items;
              queryResults = queryResults.concat(finalResult);
              queryCallback();
            }
            
          }.bind(this));
        }
      }.bind(this)); }, function() { return LastEvaluatedKey !== undefined; }, function (err){
         if (err) {
            callback(err, null);
          } else {
              if (offset !== undefined) {
                logger.log("debug", "Offset by", offset);
                queryResults = queryResults.slice(offset, limitObjects + offset);
              }
              if (limitObjects !== undefined) {
                logger.log("debug", "Limit by", limitObjects);
                queryResults = queryResults.slice(0, limitObjects);
              }
              logger.log("debug", "Sort by", orderByField, "Order:", args[orderByField] > 0 ? 'ASC' : 'DESC');
              queryResults = helper.SortByKey(queryResults, orderByField, args[orderByField]);
              if (filter && filter.include) {
                logger.log("debug", "Model includes", filter.include);
                modelObj.model.include(queryResults, filter.include, callback);
              } else {
                callback(null, queryResults);
                logger.log("debug", "Query complete");
              }
          }
      }.bind(this));
  }
};
/**
 * Find an item based on hashKey alone
 * @param  {object}   model    [description]
 * @param  {object/primitive}   pKey   : If range key is undefined,
 *                                       this is the same as hash key. If range key is defined, 
 *                                       then pKey is hashKey + (Separator) + rangeKey
 * @param  {Function} callback 
 */
DynamoDB.prototype.find = function find(model, pk, callback) {
  var timeStart = startTimer();
  var queryString = "GET AN ITEM FROM TABLE ";
  queryString = queryString + String(this.tables(model));

  var hashKey = this._models[model].hashKey;
  var rangeKey = this._models[model].rangeKey;
  var attributeSpecs = this._attributeSpecs[model];
  var hk, rk;
  var pKey = this._models[model].pKey;
  var pkSeparator = this._models[model].pkSeparator;
  if (pKey !== undefined) {
    var temp = pk.split(pkSeparator);
    hk = temp[0];
    rk = temp[1];
    queryString = queryString + " WHERE " + hashKey + " `EQ` " + hk + " " + rangeKey + " `EQ` " + rk;
    if (this._attributeSpecs[model][rangeKey] === "number") {
      rk = parseInt(rk);
    } else  if (this._attributeSpecs[model][rangeKey] === "date") {
      rk = Number(rk);
    }
  } else {
    hk = pk;
    queryString = queryString + " WHERE " + hashKey + " `EQ` " + hk;
  }
  

    // If hashKey is of type Number use parseInt
  if (this._attributeSpecs[model][hashKey] === "number") {
    hk = parseInt(hk);
  } else  if (this._attributeSpecs[model][hashKey] === "date") {
    hk = Number(hk);
  }
  
  var tableParams = {};
  tableParams.Key = {};
  tableParams.Key[hashKey] = DynamoFromJSON(hk);
  if (pKey !== undefined) {
    tableParams.Key[rangeKey] = DynamoFromJSON(rk);
  }
  
  tableParams.TableName = this.tables(model);

  tableParams.ReturnConsumedCapacity = "TOTAL";

  if (tableParams.Key) {
    this.client.getItem(tableParams, function (err, res) {
      if (err || !res) {
        callback(err, null);
      } else if (isEmpty(res)) {
        callback(null, null);
      } else {
        if (res.ConsumedCapacity && res.ConsumedCapacity.CapacityUnits) {
          var cuString = "Consumed Units: " + res.ConsumedCapacity.CapacityUnits.toString();
          logger.log("debug", cuString.magenta);
        }
        var finalResult = [];
        
        var breakables = this._models[model].breakables;
        var client = this.client;
        var pKey = this._models[model].pKey;
        var pkSeparator = this._models[model].pkSeparator;
        // Single object - > Array
        res.Items = [];
        res.Items.push(res.Item);
        async.mapSeries(res.Items, function (item, innerCallback) {
          var returnData = JSONFromDynamo(item, attributeSpecs);
            if ((rangeKey !== undefined) && (pKey !== undefined)) {
              returnData[pKey] = String(returnData[hashKey]) + pkSeparator + String(returnData[rangeKey]);
              helper.GetMyChildrenBack(returnData, model, pKey, breakables, client, innerCallback);
              logger.log("debug", "Object rebuilt");
            } else {
              helper.GetMyChildrenBack(returnData, model, hashKey, breakables, client, innerCallback);
              logger.log("debug", "Object rebuilt");
            }
        }, function (err, items) {
          if (err) {
            callback(err, null);
          } else {
            finalResult = items;
            callback(null, finalResult[0]);
            logger.log("debug", "Query complete");
          }
          
        }.bind(this));
      logger.log("info", queryString.blue, stopTimer(timeStart).bold.cyan);
      }
    }.bind(this));
    }
};

/**
 * Save an object to the database
 * @param  {[type]}   model    [description]
 * @param  {[type]}   data     [description]
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 */
DynamoDB.prototype.save = function save(model, data, callback) {
  var timeStart = startTimer();
  var originalData = {};
  var hashKey = this._models[model].hashKey;
  var rangeKey = this._models[model].rangeKey;
  var pkSeparator = this._models[model].pkSeparator;
  var pKey = this._models[model].pKey;

  /* Data is the original object coming in the body. In the body
     if the data has a key which is breakable, it must be chunked
     into N different attrs. N is specified by the breakValue[key]
  */
  var breakableAttributes = this._models[model].breakables;
  var breakableValues = this._models[model].breakValues;
  var splitSizes = this._models[model].splitSizes;
  var attributeSpecs = this._attributeSpecs[model];
  var outerCounter = 0;
  var chunkedData = {};
  var dynamo = this.client;


  /*
    Checks for hash and range keys
   */
  if ((data[hashKey] === null) || (data[hashKey] === undefined)) {
    var err = new Error("Hash Key `" + hashKey + "` cannot be null or undefined.");
    callback(err, null);
    return;
  }
  // If pKey is defined, range key is also present.
  if (pKey !== undefined) {
    if ((data[rangeKey] === null) || (data[rangeKey] === undefined)) {
      var err = new Error("Range Key `" + rangeKey + "` cannot be null or undefined.");
      callback(err, null);
      return;
    } else {
      data[pKey] = String(data[hashKey]) + pkSeparator + String(data[rangeKey]);
      originalData[pKey] = data[pKey];
    }
  }

  // Copy all attrs from data to originalData
  for (var key in data) {
    originalData[key] = data[key];
  }

  var queryString = "PUT ITEM IN TABLE ";
  queryString = queryString + String(this.tables(model));
  var tableParams = {};
  tableParams.TableName = this.tables(model);
  tableParams.ReturnConsumedCapacity = "TOTAL";

  async.mapSeries(breakableAttributes, function (breakableAttribute, OuterCallback) {
    if(data[breakableAttribute] === null && attributeSpecs[breakableAttribute] === "string") {
      data[breakableAttribute] = "null";
    }
    if(data[breakableAttribute] === undefined && attributeSpecs[breakableAttribute] === "string") {
      data[breakableAttribute] = "undefined";
    }
    if(data[breakableAttribute] === "" && attributeSpecs[breakableAttribute] === "string") {
      data[breakableAttribute] = "empty";
    }
    /*
    ChunkMe will take the data, key and the break count
    and return with new attrs appended serially from
    1 to break count. If N is specified as 0, then N is
    automatically assigned based on the size of the string
   */
    var N;
    var dataSize = Buffer.byteLength(data[breakableAttribute], 'utf8');
    // Check if splitter is defined
    if (splitSizes[outerCounter] !== undefined) {
      N = Math.ceil(dataSize / (splitSizes[outerCounter] * 1024));
    }
    logger.log("debug", "Attribute", breakableAttribute, "Datasize:", dataSize, "bytes", "No. of chunks:", N);
    chunkedData = helper.ChunkMe(data, breakableAttribute, N);
    // Write chunkedData to database
    // Use async series
    var innerCounter = 0;
    var batchWriteParams = {};
    var tableName = model + "_" + breakableAttribute;
    batchWriteParams["RequestItems"] = {};
    batchWriteParams["RequestItems"][tableName] = [];
    async.mapSeries(chunkedData, function (chunked, innerCallback) {

      // Each element in this array will be a put request.
      var chunkParamElement = {};
      chunkParamElement["PutRequest"] = {};
      chunkParamElement["PutRequest"].Item = {};

      var itemParams = {};
      var hashKeyAttribute;
      if (pKey !== undefined) {
        hashKeyAttribute = String(model).toLowerCase() + "#" + pKey;
        chunked[hashKeyAttribute] = String(data[pKey]);
      } else {
        hashKeyAttribute = String(model).toLowerCase() + "#" + hashKey;
        chunked[hashKeyAttribute] = String(data[hashKey]);
      }
      var rangeKeyAttribute = String(breakableAttribute) + "#ID";
      chunked[rangeKeyAttribute] = innerCounter + 1;

      /**
       * Item Params now holds the object in DYNAMO JSON format.
       * 
       */
      itemParams = DynamoFromJSON(chunked);
      chunkParamElement["PutRequest"].Item = itemParams;
      innerCounter++;
      innerCallback(null, chunkParamElement);

    }, function (err, innerResults) {
       if (err) {
        OuterCallback(err, null);
       } else {
        logger.log("debug", "ASSEMBLY COMPLETE");
        // innerResults consist of an array of objects with PutRequest in each of the element.
        batchWriteParams["RequestItems"][tableName] = innerResults;
        // Write to database now.
        dynamo.batchWriteItem(batchWriteParams, function (batchErr, batchResults) {
          if (batchErr) {
            OuterCallback(batchErr, null);
          } else {
            outerCounter++;
            OuterCallback(null, outerCounter);
          }
        });
       }
    }.bind(this));
  }, function (err, results) {
    if (err) {
      callback(err, null);
    } else {
      // Delete primary key
      if (pKey !== undefined) {
        delete data[pKey];    
      }
      tableParams.Item = DynamoFromJSON(data);
      dynamo.putItem(tableParams, function (err, res) {
      if (err) {
        callback(err, null);
      } else {
        if (res.ConsumedCapacity && res.ConsumedCapacity.CapacityUnits) {
          var cuString = "Consumed Units: " + res.ConsumedCapacity.CapacityUnits.toString();
          logger.log("debug", cuString.magenta);
        }
        callback(null, originalData);
      }
    }.bind(this));
    logger.log("info", queryString.blue, stopTimer(timeStart).bold.cyan);
    }
  }.bind(this));
};


DynamoDB.prototype.updateAttributes = function (model, pk, data, callback) {
  var timeStart = startTimer();
  var originalData = {};
  var hashKey = this._models[model].hashKey;
  var rangeKey = this._models[model].rangeKey;
  var pkSeparator = this._models[model].pkSeparator;
  var pKey = this._models[model].pKey;
  var hk, rk, err, key;
  var tableParams = {};
  var breakableAttributes = this._models[model].breakables;
  var breakableValues = this._models[model].breakValues;
  var splitSizes = this._models[model].splitSizes;
  var attributeSpecs = this._attributeSpecs[model];
  var outerCounter = 0;
  var chunkedData = {};
  var dynamo = this.client;
  // Copy all attrs from data to originalData
  for (key in data) {
    originalData[key] = data[key];
  }

  // If pKey is defined, range key is also present.
  if (pKey !== undefined) {
    if ((data[rangeKey] === null) || (data[rangeKey] === undefined)) {
      err = new Error("Range Key `" + rangeKey + "` cannot be null or undefined.");
      callback(err, null);
      return;
    } else {
      data[pKey] = String(data[hashKey]) + pkSeparator + String(data[rangeKey]);
      originalData[pKey] = data[pKey];
    }
  }

  // Log queryString
  var queryString = "UPDATE ITEM IN TABLE ";
  queryString = queryString + String(this.tables(model));
  
  
  // Use updateItem function of DynamoDB
  
  // Set table name as usual
  tableParams.TableName = this.tables(model);
  tableParams.Key = {};
  tableParams.AttributeUpdates = {};
  tableParams.ReturnConsumedCapacity = "TOTAL";

  // Add hashKey / rangeKey to tableParams
  if (pKey !== undefined) {
    var temp = pk.split(pkSeparator);
    hk = temp[0];
    rk = temp[1];
    tableParams.Key[this._models[model].hashKey] = DynamoFromJSON(hk);
    tableParams.Key[this._models[model].rangeKey] = DynamoFromJSON(rk);
  } else {
    tableParams.Key[this._models[model].hashKey] = DynamoFromJSON(pk);
    hk = pk;
  }
  
  async.mapSeries(breakableAttributes, function (breakableAttribute, OuterCallback) {
    if(data[breakableAttribute] === null && attributeSpecs[breakableAttribute] === "string") {
      data[breakableAttribute] = "null";
    }
    if(data[breakableAttribute] === undefined && attributeSpecs[breakableAttribute] === "string") {
      data[breakableAttribute] = "undefined";
    }
    if(data[breakableAttribute] === "" && attributeSpecs[breakableAttribute] === "string") {
      data[breakableAttribute] = "empty";
    }
    /*
    ChunkMe will take the data, key and the break count
    and return with new attrs appended serially from
    1 to break count. If N is specified as 0, then N is
    automatically assigned based on the size of the string
   */
    var N;
    var dataSize = Buffer.byteLength(data[breakableAttribute], 'utf8');
    // Check if splitter is defined
    if (splitSizes[outerCounter] !== undefined) {
      N = Math.ceil(dataSize / (splitSizes[outerCounter] * 1024));
    }
    logger.log("debug", "Attribute", breakableAttribute, "Datasize:", dataSize, "bytes", "No. of chunks:", N);
    
    chunkedData = helper.ChunkMe(data, breakableAttribute, N);
    // Write chunkedData to database
    // Use async series
    var innerCounter = 0;
    var batchWriteParams = {};
    var tableName = model + "_" + breakableAttribute;
    batchWriteParams["RequestItems"] = {};
    batchWriteParams["RequestItems"][tableName] = [];
    async.mapSeries(chunkedData, function (chunked, innerCallback) {

      // Each element in this array will be a put request.
      var chunkParamElement = {};
      chunkParamElement["PutRequest"] = {};
      chunkParamElement["PutRequest"].Item = {};

      var itemParams = {};
      var hashKeyAttribute;
      if (pKey !== undefined) {
        hashKeyAttribute = String(model).toLowerCase() + "#" + pKey;
        chunked[hashKeyAttribute] = String(data[pKey]);
      } else {
        hashKeyAttribute = String(model).toLowerCase() + "#" + hashKey;
        chunked[hashKeyAttribute] = String(data[hashKey]);
      }
      var rangeKeyAttribute = String(breakableAttribute) + "#ID";
      chunked[rangeKeyAttribute] = innerCounter + 1;

      /**
       * Item Params now holds the object in DYNAMO JSON format.
       * 
       */
      itemParams = DynamoFromJSON(chunked);
      chunkParamElement["PutRequest"].Item = itemParams;
      innerCounter++;
      innerCallback(null, chunkParamElement);

    }, function (err, innerResults) {
       if (err) {
        OuterCallback(err, null);
       } else {
        logger.log("debug", "ASSEMBLY COMPLETE");
        // innerResults consist of an array of objects with PutRequest in each of the element.
        batchWriteParams["RequestItems"][tableName] = innerResults;
        // Write to database now.
        dynamo.batchWriteItem(batchWriteParams, function (batchErr, batchResults) {
          if (batchErr) {
            OuterCallback(batchErr, null);
          } else {
            outerCounter++;
            OuterCallback(null, outerCounter);
          }
        });
       }
    }.bind(this));
  }, function (err, results) {
     if (err) {
       callback(err, null);
       return;
     } else {
      if (pKey !== undefined) {
        delete data[pKey];
      }
      // Add attrs to update
      
      for (var key in data) {
        /*if (data[key] instanceof Date) {
          data[key] = Number(data[key]);
        }*/
        if (data.hasOwnProperty(key) && data[key] !== null && (key !== hashKey) && (key !== rangeKey)) {
          tableParams.AttributeUpdates[key] = {};
          tableParams.AttributeUpdates[key].Action = 'PUT';
          tableParams.AttributeUpdates[key].Value = DynamoFromJSON(data[key]);

        }
      }
      tableParams.ReturnValues = "ALL_NEW";
      var attributeSpecs = this._attributeSpecs[model];

      dynamo.updateItem(tableParams, function (err, res) {
        if (err) {
          callback(err, null);
        } else if (!res) {
          callback(null, null);
        } else {
          if (res.ConsumedCapacity && res.ConsumedCapacity.CapacityUnits) {
            var cuString = "Consumed Units: " + res.ConsumedCapacity.CapacityUnits.toString();
            logger.log("debug", cuString.magenta);
          }
          var returnData = JSONFromDynamo(res.Attributes, attributeSpecs);
          returnData = helper.BuildMeBack(returnData, this._models[model].breakables);
          callback(null, returnData);
        }
      }.bind(this));
      logger.log("info", queryString.blue, stopTimer(timeStart).bold.cyan);
     }
  }.bind(this));
};


DynamoDB.prototype.destroy = function (model, pk, callback) {
  var timeStart = startTimer();
  var hashKey = this._models[model].hashKey;
  var rangeKey = this._models[model].rangeKey;
  var hk, rk;
  var pKey = this._models[model].pKey;
  var pkSeparator = this._models[model].pkSeparator;

  if (pKey !== undefined) {
    var temp = pk.split(pkSeparator);
    hk = temp[0];
    rk = temp[1];
    if (this._attributeSpecs[model][rangeKey] === "number") {
      rk = parseInt(rk);
    } else  if (this._attributeSpecs[model][rangeKey] === "date") {
      rk = Number(rk);
    }
  } else {
    hk = pk;
  }

    // If hashKey is of type Number use parseInt
  if (this._attributeSpecs[model][hashKey] === "number") {
    hk = parseInt(hk);
  } else  if (this._attributeSpecs[model][hashKey] === "date") {
    hk = Number(hk);
  }
  
  // Use updateItem function of DynamoDB
  var tableParams = {};
  // Set table name as usual
  tableParams.TableName = this.tables(model);
  tableParams.Key = {};
  // Add hashKey to tableParams
  tableParams.Key[this._models[model].hashKey] = DynamoFromJSON(hk);

  if (pKey !== undefined) {
    tableParams.Key[this._models[model].rangeKey] = DynamoFromJSON(rk);
  }
  
  tableParams.ReturnValues = "ALL_OLD";
  var attributeSpecs = this._attributeSpecs[model];
  var breakableAttributes = this._models[model].breakables;
  var breakableValues = this._models[model].breakValues;
  var splitSizes = this._models[model].splitSizes;
  var outerCounter = 0;
  var chunkedData = {};
  var dynamo = this.client;

  async.mapSeries(breakableAttributes, function (breakableAttribute, OuterCallback) {
    var chunkParams = {};
    chunkParams.TableName = model + "_" + breakableAttribute;
    var hashKeyAttribute;
    if (pKey !== undefined) {
      hashKeyAttribute = String(model).toLowerCase() + "#" + pKey;
    } else {
      hashKeyAttribute = String(model).toLowerCase() + "#" + hashKey;
    }
    var rangeKeyAttribute = String(breakableAttribute) + "#ID";
    chunkParams.KeyConditions = {};
    chunkParams.KeyConditions[hashKeyAttribute] = {};
    chunkParams.KeyConditions[hashKeyAttribute].ComparisonOperator = 'EQ';
    chunkParams.KeyConditions[hashKeyAttribute].AttributeValueList = [];
    if (pKey !== undefined) {
      chunkParams.KeyConditions[hashKeyAttribute].AttributeValueList.push({
        'S': String(hk) + pkSeparator + String(rk)
      });
    } else {
      chunkParams.KeyConditions[hashKeyAttribute].AttributeValueList.push({
      'S': String(hk)
    });
    }

    chunkParams.Select = "COUNT";
    dynamo.query(chunkParams, function (err, res) {
      if (err || !res) {
        OuterCallback(err, null);
        return;
      } else {
        var maxRange = res.Count;
        var numArray = [];
        for (var i = 0; i < maxRange; i++) {
          numArray[i] = i + 1;
        }
        async.mapSeries(numArray, function (rangeId, innerCallBack) {
          var innerChunkParams = {};
          innerChunkParams.Key = {};
          if (pKey !== undefined) {
            innerChunkParams.Key[hashKeyAttribute] = {
              'S': String(hk) + pkSeparator + String(rk)
            };
          } else {
            innerChunkParams.Key[hashKeyAttribute] = {
            'S': String(hk)
            };
          }
                
          innerChunkParams.Key[rangeKeyAttribute] = {
            'N': String(rangeId)
          };
          innerChunkParams.TableName = chunkParams.TableName;
          dynamo.deleteItem(innerChunkParams, function (err, res) {
            if (err) {
              innerCallBack(err, null);
            } else {
              var tempString;
              if (pKey !== undefined) {
                tempString = "DELETE FRAGMENT FROM TABLE " + chunkParams.TableName + " WHERE " + hashKeyAttribute + " `EQ` " + String(hk) + pkSeparator + String(rk) + " AND " + rangeKeyAttribute + " `EQ` " + rangeId;
              } else {
                tempString = "DELETE FRAGMENT FROM TABLE " + chunkParams.TableName + " WHERE " + hashKeyAttribute + " `EQ` " + String(hk) + " AND " + rangeKeyAttribute + " `EQ` " + rangeId;
              }
              logger.log("debug",tempString.blue);
              innerCallBack(null, rangeId);
            }
          }.bind(this));
        }, function (err, innerResults) {
          if (err) {
            OuterCallback(err, null);
          } else {
            OuterCallback(null, innerResults);
          }
        }.bind(this));
      }

    });
  }, function (err, results) {
    if (err) {
      callback(err, null);
      return;
    } else {
      dynamo.deleteItem(tableParams, function (err, res) {
        if (err) {
          callback(err, null);
        } else if (!res) {
          callback(null, null);
        } else {
          // Attributes is an object
          var tempString = "DELETE ITEM FROM TABLE " + tableParams.TableName + " WHERE " + hashKey + " `EQ` " + String(hk);
          logger.log("info", tempString.blue, stopTimer(timeStart).bold.cyan);
          callback(null, JSONFromDynamo(res.Attributes, attributeSpecs));
        }
      }.bind(this));
    }
  }.bind(this));
};

DynamoDB.prototype.defineForeignKey = function (model, key, cb) {
 var hashKey = this._models[model].hashKey;
 var attributeSpec = this._attributeSpecs[model].id || this._attributeSpecs[model][hashKey];
 if (attributeSpec === "string") {
  cb(null, String);
 } else if (attributeSpec === "number") {
  cb(null, Number);
 } else if (attributeSpec === "date") {
  cb(null, Date);
 }
};

/**
 * Destroy all deletes all records from table.
 * @param  {[type]}   model    [description]
 * @param  {Function} callback [description]
 */
DynamoDB.prototype.destroyAll = function(model, callback) {
  /*
    Note:
    Deleting individual items is extremely expensive. According to 
    AWS, a better solution is to destroy the table, and create it back again.
   */
    var timeStart = startTimer();
    var t = "DELETE EVERYTHING IN TABLE: " + this.tables(model);
    var hashKey = this._models[model].hashKey;
    var rangeKey = this._models[model].rangeKey;
    var pkSeparator = this._models[model].pkSeparator;
    var attributeSpecs = this._attributeSpecs[model];
    var hk, rk, pk;
    var dynamo = this.client;
    var self = this;
    var tableParams = {};
    tableParams.TableName = this.tables(model);
    dynamo.scan(tableParams, function (err, res){
      if (err) {
        callback(err);
        return;
      } else if (res === null) {
        callback(null);
        return;
      } else {
      async.mapSeries(res.Items,function (item, insideCallback) {

        if (rangeKey === undefined) {
          hk = JSONFromDynamo(item, attributeSpecs)[hashKey];
          pk = hk;
        } else {
          hk = JSONFromDynamo(item, attributeSpecs)[hashKey];
          rk = JSONFromDynamo(item, attributeSpecs)[rangeKey];
          pk = String(hk) + pkSeparator + String(rk);
        }
        self.destroy(model, pk, insideCallback);
      },function(err, items){
        if (err) {
          callback(err);
        } else {
          callback();
        }
        
      }.bind(this));
      }

    });
  logger.log("warn", t.bold.red, stopTimer(timeStart).bold.cyan);
};

/**
 * Get number of records matching a filter
 * @param  {Object}   model    
 * @param  {Function} callback 
 * @param  {Object}   where    : Filter
 * @return {Number}            : Number of matching records
 */
DynamoDB.prototype.count = function count(model, callback, where) {
  var filter = {};
  filter.where = where;
  this.all(model, filter, function(err, results){
    if (err || !results) {
      callback(err, null);
    } else {
      callback(null, results.length);
    }
  });
};

/**
 * Check if a given record exists
 * @param  {[type]}   model    [description]
 * @param  {[type]}   id       [description]
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 */
DynamoDB.prototype.exists = function exists(model, id, callback) {
  this.find(model, id, function (err, record){
    if (err) {
      callback(err, null);
    } else if(isEmpty(record)) {
      callback(null, false);
    } else {
      callback(null, true);
    }
  });
};