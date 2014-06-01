/**
 * Module dependencies
 */

var AWS = require('aws-sdk');
var colors = require('colors');
var helper = require('./helper.js');

exports.initialize = function initializeSchema(schema, callback) {
  console.log("Initializing dynamodb adapter");

  // s stores the schema settings
  var s = schema.settings;


  if (schema.settings) {
    s.host = schema.settings.host || "localhost";
    s.port = schema.settings.port || 8000;
    s.region = schema.settings.region || "ap-southeast-1";
    s.accessKeyId = schema.settings.accessKeyId || "fake";
    s.secretAccessKey = schema.settings.secretAccessKey || "fake";
    s.ReadCapacityUnits = schema.settings.ReadCapacityUnits || 5;
    s.WriteCapacityUnits = schema.settings.WriteCapacityUnits || 10;
  }
  schema.adapter = new DynamoDB(s, schema, callback);
};

function DynamoDB(s, schema, callback) {
  if (!AWS) {
    throw new Error("AWS SDK not installed. Please run npm install aws-sdk");
    return;
  }
  var i, n;
  this.name = 'dynamodb';
  this._models = {};
  this._tables = {};
  this._ReadCapacityUnits = s.ReadCapacityUnits;
  this._WriteCapacityUnits = s.WriteCapacityUnits;
  this._attributeSpecs = [];
  // Connect to dynamodb server
  /*AWS.config.update({
    accessKeyId: s.accessKeyId,
    secretAccessKey: s.secretAccessKey,
    region: s.region
  });*/
	AWS.config.update({
    accessKeyId: "fake",
    secretAccessKey: "fake",
    region: "ap-southeast-1"
  });
		
	var dynamodb= new AWS.DynamoDB({ endpoint: new AWS.Endpoint('http://' + s.host+':'+s.port) });
  schema.adapter = dynamodb;
  this.adapter = dynamodb; // Used by instance methods
  callback();
}


/*
	Assign Attribute Definitions
	and KeySchema based on the keys
*/
function AssignKeys(name, type, settings) {
  var attr = {};
  attr.keyType = name.keyType;
  var tempString = (name.type).toString();
  var aType = tempString.match(/\w+(?=\(\))/)[0];
  aType = aType.toLowerCase();
  attr.attributeType = helper.TypeLookup(aType);
  return attr;
}

/**
 * Define schema and create table with hash and range keys
 * @param  {object} descr : description specified in the schema
 */
DynamoDB.prototype.define = function (descr) {
  if (!descr.settings) descr.settings = {};
  var modelName = descr.model.modelName;
  this._models[modelName] = descr;
  this._models[modelName].hashKey = {};
  this._models[modelName].rangeKey = [];
  // Create table now with the hash and range index.
  var properties = descr.properties;
  // Iterate through properties and find index
  var tableParams = {};
  tableParams.AttributeDefinitions = [];
  tableParams.KeySchema = [];
  this._models[modelName].breakables = [];
  this._models[modelName].breakValues = [];
  this._attributeSpecs[modelName] = {};
  /*
    Build KeySchema for the table based on schema definitions.
   */
  for (var key in properties) {
    // Assign breakers, limits or whatever other properties
    // are specified first
    
    // Store the type of attributes in _attributeSpecs. This is
    // quite helpful later to do Date & Boolean conversions later
    // on.
    var tempString = (properties[key].type).toString();
    var aType = tempString.match(/\w+(?=\(\))/)[0];
    aType = aType.toLowerCase();
    this._attributeSpecs[modelName][key] = aType;
    if (properties[key].breaker !== undefined) {
       /*
        The key specifies that the attribute value must
        be broken down into N chunks where N is the value
        of breaker
       */
      this._models[modelName].breakables.push(key);
      this._models[modelName].breakValues.push(properties[key].breaker);
    }
    var attributes = AssignKeys(properties[key]);
    // The keys have come! Add to tableParams
    // Add Attribute Definitions

    // HASH primary key?
    if (attributes.keyType === "hash") {
      this._models[modelName].hashKey = key;
      tableParams.KeySchema.push({
        AttributeName: key,
        KeyType: 'HASH'
      });
      tableParams.AttributeDefinitions.push({
        AttributeName: key,
        AttributeType: attributes.attributeType
      });
    }
    // Range primary key?
    if (attributes.keyType === "range") {
      this._models[modelName].rangeKey.push(key);
      tableParams.KeySchema.push({
        AttributeName: key,
        KeyType: 'RANGE'
      });
      tableParams.AttributeDefinitions.push({
        AttributeName: key,
        AttributeType: attributes.attributeType
      });
    }
  }
  // Hard code throughput for now
  tableParams.ProvisionedThroughput = {
    ReadCapacityUnits: this._ReadCapacityUnits,
    WriteCapacityUnits: this._WriteCapacityUnits
  };
  // Assign table name
  tableParams.TableName = descr.model.modelName;
  var tableExists = false;
  this.adapter.listTables(function (err, data) {
    if (err) {
      console.log(err.toString());
      console.log("-------Error while fetching tables from server. Please check your connection settings & AWS config--------");
      return;
    }
    // Boolean variable to check if table already exists.
    var existingTableNames = data.TableNames;
    existingTableNames.forEach(function (existingTableName) {
      if (tableParams.TableName === existingTableName) {
        tableExists = true;
        console.log("----------Table %s found in database----------",existingTableName);
      }
    });
    // If table exists do not create new table
    if (tableExists === false) {
      // DynamoDB will throw error saying table does not exist
      console.log("----------Creating Table: %s in DynamoDB----------", tableParams.TableName);
      this.adapter.createTable(tableParams, function (err, data) {
        if (err) {
          console.log(err.toString());
        } // an error occurred
        else if (!data) {
          console.log("Could not create table");
        } else {
          console.log("Table created");
        }; // successful response
      });
    }
  }.bind(this));

};

/**
 * Creates a DynamoDB compatible representation
 * of arrays, objects and primitives.
 * @param {object} data: Object to be converted
 * @return {object} DynamoDB compatible JSON
 */
function DynamoFromJSON(data) {
	/*
		If data is an array, loop through each member
		of the array, and call objToDB on the element
		e.g ["someword",20] --> [ {'S': 'someword'} , {'N' : '20'}]
	 */
  if (data instanceof Array) {
    var obj = [];
    data.forEach(function (dataElement) {
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
  else if (data instanceof Object) {
    var obj = {};
    for (var key in data) {
      if (data.hasOwnProperty(key)) {
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
     obj = helper.objToDB(data);
  }
  return obj;
}

function JSONFromDynamo(data, attributeSpecs) {
	if (data instanceof Object) {
    var obj = {};
    for (var key in data) {
      if (data.hasOwnProperty(key)) {
        obj[key] = helper.objFromDB(data[key]);
       
        if (attributeSpecs[key] === "date") {
           obj[key] = new Date(obj[key]);
        }
        if (attributeSpecs[key] === "boolean") {
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
  // If jugglingdb defined id is undefined, and it is not a
  // hashKey , then delete it.
  if ((data.id === undefined) && (this._models[model].hashKey !== id)) {
    delete data.id;
  }
  var queryString = "DYNAMODB >>> CREATE ITEM " +  String(model) + " IN TABLE " + this.tables(model);
	console.log(queryString.blue);
  var tableParams = {};
  tableParams.TableName = this.tables(model);
  /* Data is the original object coming in the body. In the body
     if the data has a key which is breakable, it must be chunked
     into N different attributes. N is specified by the breakValue[key]
  */
  var breakableAttributes = this._models[model].breakables;
  var breakableValues = this._models[model].breakValues;
  var outerCounter = 0;
  breakableAttributes.forEach(function (breakableAttribute) {

    /*
    ChunkMe will take the data, key and the break count
    and return with new attributes appended serially from 
    1 to break count. If N is specified as 0, then N is
    automatically assigned based on the size of the string
   */
    var N;
    if (breakableValues[outerCounter] === 0) {
      var dataSize = Buffer.byteLength(data[breakableAttribute], 'utf8');
      console.log("Datasize: ", dataSize, "bytes");
      N = Math.ceil(dataSize / 50000);
      console.log("No. of chunks: ", N);
    } else {
      N = breakableValues[outerCounter];
    }
    data = helper.ChunkMe(data, breakableAttribute, N);
    outerCounter++;
  });
  tableParams.Item = DynamoFromJSON(data);
  this.adapter.putItem(tableParams, function (err, res) {
    if (err) {
    	console.log(err.toString());
      callback(err, null);
    } else {
      callback(null, data);
    }
  });
};



function query(model, filter, hashKey, queryString) {
  // Table parameters to do the query/scan
  var tableParams = {};

  // Define the filter if it does not exist
  if (!filter) {
    filter = {};
  }
  // Initialize query as an empty object
  var query = {};
  // Construct query for amazon DynamoDB
  tableParams.KeyConditions = {};
  // Set queryfileter to empty object
  tableParams.QueryFilter = {};
  // If a where clause exists in the query, extract
  // the conditions from it.
  if (filter.where) {
  	queryString = queryString + " WHERE ";
    for (key in filter.where) {
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
        // insideKey now holds gt and condition now holds Date.now()
        query[key] = {
          operator: OperatorLookup(insideKey),
          attributes: condition
        };
      } else if (condition && condition.constructor.name === "Array") {
        query[key] = {
          operator: 'IN',
          attributes: condition
        };
      } else {
        query[key] = {
          operator: 'EQ',
          attributes: condition
        };
      }
      if (key === hashKey) {
        // Add hashkey eq condition to keyconditions
        tableParams.KeyConditions[key] = {};
        tableParams.KeyConditions[key].ComparisonOperator = query[key].operator;
        tableParams.KeyConditions[key].AttributeValueList = [];
        tableParams.KeyConditions[key].AttributeValueList.push(DynamoFromJSON(query[key].attributes));
        queryString = queryString + " HASHKEY: `" + String(key) + "` " + String(query[key].operator) + " `" + String(query[key].attributes) + "`";
      } else {
        tableParams.QueryFilter[key] = {};
        tableParams.QueryFilter[key].ComparisonOperator = query[key].operator;
        tableParams.QueryFilter[key].AttributeValueList = [];
        tableParams.QueryFilter[key].AttributeValueList.push(DynamoFromJSON(query[key].attributes));
        queryString = queryString + " `" + String(key) + "` " + String(query[key].operator) + " `" + String(query[key].attributes) + "`";
      }
      
    }
  }
  queryString = queryString + ' WITH QUERY OPERATION ';
  console.log(queryString.blue);
  return tableParams;
}


function scan(model, filter, queryString) {
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
    for (key in filter.where) {
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
        insideKey = Object.keys(condition)[0];
        condition = condition[insideKey];
        // insideKey now holds gt and condition now holds Date.now()
        query[key] = {
          operator: OperatorLookup(insideKey),
          attributes: condition
        };
      } else if (condition && condition.constructor.name === "Array") {
        query[key] = {
          operator: 'IN',
          attributes: condition
        };
     } else {
        query[key] = {
          operator: 'EQ',
          attributes: condition
        };
      }

      tableParams.ScanFilter[key] = {};
      tableParams.ScanFilter[key].ComparisonOperator = query[key].operator;
      tableParams.ScanFilter[key].AttributeValueList = [];
      tableParams.ScanFilter[key].AttributeValueList.push(DynamoFromJSON(query[key].attributes));
      queryString = queryString + " `" + String(key) + "` " + String(query[key].operator) + " `" + String(query[key].attributes) + "`";
    }
    }
  queryString = queryString + ' WITH SCAN OPERATION ';
  console.log(queryString.blue);
  return tableParams;
}


/**
 *  Uses Amazon DynamoDB query/scan function to fetch all
 *  matching entries in the table.
 *
 */
DynamoDB.prototype.all = function all(model, filter, callback) {
	var queryString = "DYNAMODB >>> GET ALL ITEMS FROM TABLE ";
	queryString = queryString + String(this.tables(model));
  // If hashKey is present in where filter, use query
  var hashKeyFound = false;
  if (filter && filter.where) {
    for (var key in filter.where) {
      if (key === this._models[model].hashKey) {
        hashKeyFound = true;
      }
    }
  }
  // If true use query function
  if (hashKeyFound === true) {
    var tableParams = query(model, filter, this._models[model].hashKey, queryString);
    // Set table name based on model
    tableParams.TableName = this.tables(model);
    var attributeSpecs = this._attributeSpecs[model];
    // If KeyConditions exist, then call DynamoDB query function
    if (tableParams.KeyConditions) {

      this.adapter.query(tableParams, function (err, res) {
        if (err) {
        	console.log(err.toString().red);
          callback(err, null);
        } else if (!res) {
          callback(null, null);
        } else {
        	// Returns an array of objects. Pass each one to
        	// JSONFromDynamo and push to empty array
        	var finalResult = [];
        	res.Items.forEach(function (item){
            var returnData = JSONFromDynamo(item, attributeSpecs);
            returnData = helper.BuildMeBack(returnData, this._models[model].breakables);
        		finalResult.push(returnData);
        	}.bind(this));
          callback(null, finalResult);
        }
      }.bind(this));
    }
  } else {
    // Call scan function
    var tableParams = scan(model, filter, queryString);
    tableParams.TableName = this.tables(model);
    var attributeSpecs = this._attributeSpecs[model];
    // Scan DynamoDB table
    this.adapter.scan(tableParams, function (err, res) {
      if (err) {
      	console.log(err.toString().red);
        callback(err, null);
      } else if (!res) {
        callback(null, null);
      } else {
        // Returns an array of objects. Pass each one to
        	// JSONFromDynamo and push to empty array
        	var finalResult = [];
          res.Items.forEach(function (item){
            var returnData = JSONFromDynamo(item, attributeSpecs);
            returnData = helper.BuildMeBack(returnData, this._models[model].breakables);
            finalResult.push(returnData);
          }.bind(this));
          callback(null, finalResult);
      }
    }.bind(this));
  }
};

/**
 * [find description]
 * @param  {[type]}   model    [description]
 * @param  {[type]}   hashKey  [description]
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 */
DynamoDB.prototype.find = function find(model, hashKey, callback) {
	var queryString = "DYNAMODB >>> GET AN ITEM FROM TABLE ";
	queryString = queryString + String(this.tables(model));
  var filter = {};
  filter.where = {};

  hashKey = parseInt(hashKey);
  filter.where[this._models[model].hashKey] = hashKey;

  var tableParams = query(model, filter, this._models[model].hashKey, queryString);
  tableParams.TableName = this.tables(model);
  var attributeSpecs = this._attributeSpecs[model];
  if (tableParams.KeyConditions) {
    this.adapter.query(tableParams, function (err, res) {
      if (err) {
        callback(err, null);
      } else if (!res) {
        callback(null, null);
      } else {
        // Response is an array of objects
        var returnData = JSONFromDynamo(res.Items[0], attributeSpecs);
        returnData = helper.BuildMeBack(returnData, this._models[model].breakables);
        callback(null, returnData);
      }
    }.bind(this));
  }
};

DynamoDB.prototype.save = function save(model, data, callback) {
  var queryString = "DYNAMODB >>> PUT ITEM IN TABLE ";
  queryString = queryString + String(this.tables(model));
  var tableParams = {};
  tableParams.TableName = this.tables(model);
  /* Data is the original object coming in the body. In the body
     if the data has a key which is breakable, it must be chunked
     into N different attributes. N is specified by the breakValue[key]
  */
  var breakableAttributes = this._models[model].breakables;
  var breakableValues = this._models[model].breakValues;
  var outerCounter = 0;
  breakableAttributes.forEach(function (breakableAttribute) {

    /*
    ChunkMe will take the data, key and the break count
    and return with new attributes appended serially from 
    1 to break count. If N is specified as 0, then N is
    automatically assigned based on the size of the string
   */
    var N;
    if (breakableValues[outerCounter] === 0) {
      var dataSize = Buffer.byteLength(data[breakableAttribute], 'utf8');
      console.log("Datasize: ", dataSize, "bytes");
      N = Math.ceil(dataSize / 50000);
      console.log("No. of chunks: ", N);
    } else {
      N = breakableValues[outerCounter];
    }
    data = helper.ChunkMe(data, breakableAttribute, N);
    outerCounter++;
  });
  tableParams.Item = DynamoFromJSON(data);
  this.adapter.putItem(tableParams, function (err, res) {
    if (err) {
      console.log(err.toString().red);
      callback(err, null);
    } else {
      callback(null, data);
    }
  });
};

DynamoDB.prototype.updateAttributes = function (model, hashKey, data, callback) {
	var queryString = "DYNAMODB >>> UPDATE ITEM IN TABLE ";
	queryString = queryString + String(this.tables(model));
  // Use updateItem function of DynamoDB
  var tableParams = {};
  // Set table name as usual
  tableParams.TableName = this.tables(model);
  tableParams.Key = {};
  tableParams.AttributeUpdates = {};
  // Add hashKey to tableParams
  tableParams.Key[this._models[model].hashKey] = DynamoFromJSON(hashKey);
  // Chunk chunkable data first
  var breakableAttributes = this._models[model].breakables;
  var breakableValues = this._models[model].breakValues;
  var outerCounter = 0;
  breakableAttributes.forEach(function (breakableAttribute) {

    /*
    ChunkMe will take the data, key and the break count
    and return with new attributes appended serially from 
    1 to break count. If N is specified as 0, then N is
    automatically assigned based on the size of the string
   */
    var N;
    if (breakableValues[outerCounter] === 0) {
      var dataSize = Buffer.byteLength(data[breakableAttribute], 'utf8');
      console.log("Datasize: ", dataSize, "bytes");
      N = Math.ceil(dataSize / 50000);
      console.log("No. of chunks: ", N);
    } else {
      N = breakableValues[outerCounter];
    }
    data = helper.ChunkMe(data, breakableAttribute, N);
    outerCounter++;
  });

  // Add attributes to update
  for (key in data) {
    if (data.hasOwnProperty(key) && data[key] !== null && (key !== this._models[model].hashKey)) {
      // Special hack needed for now
      if (data[key] instanceof Date) {
        data[key] = Number(data[key]);
      }
      tableParams.AttributeUpdates[key] = {};
      tableParams.AttributeUpdates[key].Action = 'PUT';
      tableParams.AttributeUpdates[key].Value = DynamoFromJSON(data[key]);
    }
  }
  tableParams.ReturnValues = "ALL_NEW";
  var attributeSpecs = this._attributeSpecs[model];
  this.adapter.updateItem(tableParams, function (err, res) {
    if (err) {
      console.log(err.toString());
      callback(err, null);
    } else if (!res) {
      callback(null, null);
    } else {
      callback(null, JSONFromDynamo(res.Attributes, attributeSpecs));
    }
  });
};

DynamoDB.prototype.destroy = function(model, hashKey, callback) {
  var queryString = "DYNAMODB >>> DELETE ITEM FROM TABLE ";
  queryString = queryString + String(this.tables(model));
  queryString = queryString + " WHERE `" + String(this._models[model].hashKey) + "` EQ `"+ String(hashKey) + "`";
  console.log(queryString.blue);
	// Use updateItem function of DynamoDB
  var tableParams = {};
  // Set table name as usual
  tableParams.TableName = this.tables(model);
  tableParams.Key = {};
  // Add hashKey to tableParams
  tableParams.Key[this._models[model].hashKey] = DynamoFromJSON(hashKey);
  tableParams.ReturnValues = "ALL_OLD";
  var attributeSpecs = this._attributeSpecs[model];
   this.adapter.deleteItem(tableParams, function (err, res) {
    if (err) {
      console.log(err.toString());
      callback(err, null);
    } else if (!res) {
      callback(null, null);
    } else {
      // Attributes is an object
      callback(null, JSONFromDynamo(res.Attributes, attributeSpecs));
    }
  });
};