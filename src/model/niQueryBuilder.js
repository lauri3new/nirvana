/**
 * Created by karthikvasudevan on 15/08/2017.
 * License: MIT
 */
'use strict';

require('../utils/niType');
require('../utils/niLoop');
require('../utils/niLog');
const niOperator = require('./niOperator');
const CHARS_GLOBAL_REGEXP = /[\0\b\t\n\r\x1a"'\\]/g; // eslint-disable-line no-control-regex
const CHARS_ESCAPE_MAP    = {
  '\0'   : '\\0',
  '\b'   : '\\b',
  '\t'   : '\\t',
  '\n'   : '\\n',
  '\r'   : '\\r',
  '\x1a' : '\\Z',
  '"'    : '\\"',
  '\''   : '\\\'',
  '\\'   : '\\\\'
};

class NIQueryBuilder {
  constructor() {
    this._query = '';
    this._treatValueAsField = false;
  }

  select(fields) {
    if (niIsOfType(fields, NIArray)) {
      this._query = `SELECT ${this._formatField(fields)} `;
    } else {
      this._query = 'SELECT * ';
    }
    return this;
  }

  from(param) {
    this._query += this._tableDeclaration('FROM', param);
    return this;
  }

  innerJoin(param) {
    this._query += this._tableDeclaration('INNER JOIN', param);
    return this;
  }

  leftJoin(param) {
    this._query += this._tableDeclaration('LEFT JOIN', param);
    return this;
  }

  rightJoin(param) {
    this._query += this._tableDeclaration('RIGHT JOIN', param);
    return this;
  }

  on(condition) {
    this._treatValueAsField = true; //enable the on condition so the values are treated as fields for condition
    this._query += `ON ${this._condition(condition)}`;
    this._treatValueAsField = false; //disable the on condition
    return this;
  }

  alias(param) {
    this._query += `AS \`${param}\` `;
    return this;
  }

  as(param) {
    this.alias(param);
    return this;
  }

  where(condition) {
    this._query += `WHERE ${this._condition(condition)} `;
    return this;
  }

  groupBy(fields) {
    if (niIsOfType(fields, NIArray)) {
      this._query = `GROUP BY ${this._formatField(fields)} `;
    } else {
      throw new TypeError('Group by expects array as input');
    }
    return this;
  }

  orderBy(fields) {
    if (niIsOfType(fields, NIArray)) {
      this._query = `ORDER BY ${this._formatField(fields)} `;
    } else {
      throw new TypeError('Order by expects array as input');
    }
    return this;
  }

  having(condition) {
    this._query += `HAVING ${this._condition(condition)} `;
    return this;
  }

  limit(limit, offset) {
    this._query += `LIMIT ${limit}`;
    if (offset) {
      this._query += `, ${offset} `;
    }
    return this;
  }

  union() {
    let queryString = '';
    [...arguments].forEach(function(item) {
      if (item instanceof NIQueryBuilder) {
        queryString += `(${item._query.trim()}) UNION `;
      }
    });

    this._query += queryString.substring(0, queryString.length - 7);
    return this;
  }

  insert() {
    this._query = 'INSERT ';
    return this;
  }

  into(tableName) {
    this._query += `INTO ${tableName} `;
    return this;
  }

  values(obj) {

  }

  update(tableName) {
    this._query = `UPDATE ${tableName} `;
    return this;
  }

  byQuery(query) {
    if (niIsOfType(query, NIString)) {
      this._query = query;
    } else {
      throw new TypeError('Query must be a valid sql string');
    }
    return this;
  }

  getQuery() {
    return this._query.trim();
  }

  printQuery() {
    niLog(this.getQuery());
  }

  _condition(_where, operator = 'AND') {
    let queryString = '';

    if (!niIsOfType(_where, NIArray)) {
      throw new TypeError(`NIQueryBuilder expects an array for where condition instead of ${niTypeOf(_where)}`);
    }
    _where.niLoop((item) => {
      if (item.niIsOfType(NIDictionary)) {
        queryString += this._parseCondition(item, operator);
      } else if (item.niIsOfType(NIArray)) {
        queryString += `(${this._condition(item, 'OR')}) AND `;
      } else {
        throw new TypeError(`NIQueryBuilder expects an array of arrays or objects for where condition instead of array of ${niTypeOf(_where)}`);
      }
    });
    return queryString.substring(0, queryString.length - 4);
  }

  _parseCondition(item, operator) {
    let fieldName = Object.keys(item)[0];
    let condition = Object.keys(item[fieldName])[0];
    let conditionOperator = (niOperator[condition]) ? niOperator[condition] : condition;
    let value = this._conditionOperatorException(item[fieldName][condition], conditionOperator);
    fieldName = this._formatField(fieldName);
    return `(${fieldName} ${conditionOperator} ${value}) ${operator} `;
  }

  _conditionOperatorException(value, conditionOperator) {
    switch (conditionOperator) {
      case 'BETWEEN':
      case 'NOT BETWEEN':
        if (niIsOfType(value, NIArray)) {
          value = `${this._escapeString(value[0])} AND ${this._escapeString(value[1])}`;
        } else {
          throw new TypeError('Expects an array for BETWEEN and NOT BETWEEN conditions');
        }
        break;
      case 'IN':
      case 'NOT IN':
        if (niIsOfType(value, NIArray)) {
          value = `('${value.join('\',\'')}')`;
        } else {
          throw new TypeError('Expects an array for IN and NOT IN conditions');
        }
        break;
      case 'IS':
      case 'IS NOT':
        if (niIsOfType(value, NINull)) {
          value = 'NULL';
        } else if (!niIsOfType(value, NIBoolean)) { //if boolean, return the value itself
          throw new TypeError('Expects boolean or null for IS and IS NOT conditions');
        }
        break;
      default: // null should not be checked here so all nulls will be wrapped as string
        value = this._escapeString(this._checkForFunctions(value, ''));
        break;
    }
    return value;
  }

  _formatField(field) {
    let fieldStr = '', _this = this;
    if (niIsOfType(field, NIArray)) {
      field.niLoop(function(item) {
        if (niIsOfType(item, NIString)) {
          fieldStr += `${_this._checkForFunctions(item)}, `;
        }
      });
      fieldStr = fieldStr.substring(0, fieldStr.length - 2);
    } else if (niIsOfType(field, NIString)) {
      fieldStr += `${_this._checkForFunctions(field)}`;
    } else {
      throw new TypeError('Expecting array or string for fields');
    }
    return fieldStr;
  }

  _checkForFunctions(value, wrapping = '`') {
    if (value.indexOf('(') >= 0 && value.indexOf(')') >= 0) {
      return value;
    } else if ((value.indexOf('.') >= 0 && wrapping === '`') || (this._treatValueAsField)) {
      let valSplit = value.split('.');
      if (valSplit.length > 1) {
        return `\`${valSplit[0]}\`.\`${valSplit[1]}\``;
      } else {
        return `\`${valSplit[0]}\``;
      }
    } else if (niIsOfType(value, NINull)) {
      return 'NULL';
    } else {
      return `${wrapping}${value}${wrapping}`;
    }
  }

  _tableDeclaration(keyword, param) {
    let query = '';
    if (param instanceof NIQueryBuilder) {
      query = `${keyword} (${param._query.trim()}) `;
    } else {
      query = `${keyword} \`${param}\` `;
    }
    return query;
  }

  //The below code is Copyright (c) 2012 Felix Geisendörfer (felix@debuggable.com) and contributors
  _escapeString(val) {
    if (!this._treatValueAsField) {
      let chunkIndex = CHARS_GLOBAL_REGEXP.lastIndex = 0;
      let escapedVal = '';
      let match;

      while ((match = CHARS_GLOBAL_REGEXP.exec(val))) {
        escapedVal += val.slice(chunkIndex, match.index) + CHARS_ESCAPE_MAP[match[0]];
        chunkIndex = CHARS_GLOBAL_REGEXP.lastIndex;
      }

      if (chunkIndex === 0) {
        // Nothing was escaped
        return '\'' + val + '\'';
      }

      if (chunkIndex < val.length) {
        return '\'' + escapedVal + val.slice(chunkIndex) + '\'';
      }

      return '\'' + escapedVal + '\'';
    } else {
      return val;
    }
  }
}
let start = +new Date();
new NIQueryBuilder()
  .select(['M.name', 'M.id', 'M._deleteDate', 'S._deleteDate'])
  .from('Merchant')
  .as('M')
  .innerJoin('Store')
  .as('S')
  .on([{'S.__merchantId': {$eq: 'M.id'}}, {'S.id': {$eq: 'M.id'}}])
  .where([
    {'S._deleteDate': {$is: null}},
    {'M._deleteDate': {$is: null}},
    {'M.name': {$in: [1,2,3,4,5]}},
    {'S.city': {$like: '%london%'}},
    {'S.timestamp': {$between: ['2018-01-01 00:00:00', '2018-07-01 00:00:00']}}
  ])
  .limit(1, 10)
  .printQuery();
let end = +new Date();
console.log(end - start);
