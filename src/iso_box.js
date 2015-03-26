var ISOBox = function() {
  this._cursor = new ISOBoxer.Cursor();
}

ISOBox.parse = function(parent) {
  var newBox = new ISOBox();
  newBox._offset = parent._cursor.offset;
  newBox._raw = parent._raw;
  newBox._parseBox();
  newBox._parent = parent;
  parent._cursor.offset = newBox._raw.byteOffset + newBox._raw.byteLength;
  return newBox;
}

ISOBox.prototype._readUint = function(size) {
  var result = null;
  switch(size) {
  case 8:
    result = this._raw.getUint8(this._cursor.offset - this._raw.byteOffset);
    break;
  case 16:
    result = this._raw.getUint16(this._cursor.offset - this._raw.byteOffset);
    break;
  case 24:
    var s1 = this._raw.getUint16(this._cursor.offset - this._raw.byteOffset);
    var s2 = this._raw.getUint8(this._cursor.offset - this._raw.byteOffset + 2);
    result = (s1 << 4) + s2;
    break;
  case 32:
    result = this._raw.getUint32(this._cursor.offset - this._raw.byteOffset);
    break;
  case 64:
    var s1 = this._raw.getUint32(this._cursor.offset - this._raw.byteOffset);
    var s2 = this._raw.getUint32(this._cursor.offset - this._raw.byteOffset + 4);
    result = (s1 << 8) + s2;
    break;
  }
  this._cursor.offset += (size >> 3);
  return result;        
}

ISOBox.prototype._readString = function(length) {
  var str = '';
  for (var c = 0; c < length; c++) {
    var char = this._readUint(8);
    str += String.fromCharCode(char);
  }
  return str;    
}

ISOBox.prototype._readTerminatedString = function() {
  var str = '';
  while (true) {
    var char = this._readUint(8);
    if (char == 0) break;
    str += String.fromCharCode(char);
  }
  return str;
}

ISOBox.prototype._readTemplate = function(size) {
  var pre = this._readUint(size / 2);
  var post = this._readUint(size / 2);
  return pre + (post / Math.pow(2, size / 2));
}

ISOBox.prototype._parseBox = function() {
  this._cursor.offset = this._offset;
  this.size = this._readUint(32);
  this.type = this._readString(4);

  if (this.size == 1)      { this.largesize = this._readUint(64); }
  if (this.type == 'uuid') { this.usertype = this._readString(16); }

  switch(this.size) {
  case 0:
    this._raw = new DataView(this._raw.buffer, this._offset, (this._raw.byteLength - this._cursor.offset));
    break;
  case 1:
    this._raw = new DataView(this._raw.buffer, this._offset, this.largesize);
    break;
  default:
    this._raw = new DataView(this._raw.buffer, this._offset, this.size);
  }

  // additional parsing
  if (this._boxParsers[this.type]) this._boxParsers[this.type].call(this);    
}

ISOBox.prototype._parseFullBox = function() {
  this.version = this._readUint(8);
  this.flags = this._readUint(24);
}

ISOBox.prototype._boxParsers = {};

// Simple container boxes
// ISO/IEC 14496-12:2012 - 8.2.1 Movie Box
// ISO/IEC 14496-12:2012 - 8.3.1 Track Box
// ISO/IEC 14496-12:2012 - 8.4.1 Media Box
// ISO/IEC 14496-12:2012 - 8.8.4 Movie Fragment Box
// ISO/IEC 14496-12:2012 - 8.8.6 Track Fragment Box
ISOBox.prototype._boxParsers['moov'] =
ISOBox.prototype._boxParsers['trak'] =
ISOBox.prototype._boxParsers['mdia'] =
ISOBox.prototype._boxParsers['moof'] =
ISOBox.prototype._boxParsers['traf'] = function() {
  this.boxes = [];
  while (this._cursor.offset - this._raw.byteOffset < this._raw.byteLength) {
    this.boxes.push(ISOBox.parse(this));
  }  
}

// ISO/IEC 23009-1:2014 - 5.10.3.3 Event Message Box
ISOBox.prototype._boxParsers['emsg'] = function() {
  this._parseFullBox();
  this.scheme_id_uri           = this._readTerminatedString();
  this.value                   = this._readTerminatedString();
  this.timescale               = this._readUint(32);
  this.presentation_time_delta = this._readUint(32);
  this.event_duration          = this._readUint(32);
  this.id                      = this._readUint(32);
  this.message_data            = new DataView(this._raw.buffer, this._cursor.offset, this._raw.byteLength - (this._cursor.offset - this._offset));
}

// ISO/IEC 14496-12:2012 - 8.1.2 Free Space Box
ISOBox.prototype._boxParsers['free'] = ISOBox.prototype._boxParsers['skip'] = function() {
  this.data = new DataView(this._raw.buffer, this._cursor.offset, this._raw.byteLength - (this._cursor.offset - this._offset));
}

// ISO/IEC 14496-12:2012 - 4.3 File Type Box / 8.16.2 Segment Type Box
ISOBox.prototype._boxParsers['ftyp'] = ISOBox.prototype._boxParsers['styp'] = function() {
  this.major_brand = this._readString(4);
  this.minor_versions = this._readUint(32);
  this.compatible_brands = [];
  
  while (this._cursor.offset - this._raw.byteOffset < this._raw.byteLength) {
    this.compatible_brands.push(this._readString(4));
  }
}

// ISO/IEC 14496-12:2012 - 8.1.1 Media Data Box
ISOBox.prototype._boxParsers['mdat'] = function() {
  this.data = new DataView(this._raw.buffer, this._cursor.offset, this._raw.byteLength - (this._cursor.offset - this._offset));
}

// ISO/IEC 14496-12:2012 - 8.4.2 Media Header Box
ISOBox.prototype._boxParsers['mdhd'] = function() {
  this._parseFullBox();
  if (this.version == 1) {
    this.creation_time = this._readUint(64);
    this.modification_time = this._readUint(64);
    this.timescale = this._readUint(32);
    this.duration = this._readUint(64);
  } else {
    this.creation_time = this._readUint(32);
    this.modification_time = this._readUint(32);
    this.timescale = this._readUint(32);
    this.duration = this._readUint(32);
  }
  var language = this._readUint(16);
  this.pad = (language >> 15);
  this.language = String.fromCharCode(
    ((language >> 10) & 0x1F) + 0x60,
    ((language >> 5) & 0x1F) + 0x60,
    (language & 0x1F) + 0x60
  );
  this.pre_defined = this._readUint(16);
}

// ISO/IEC 14496-12:2012 - 8.8.5 Movie Fragment Header Box
ISOBox.prototype._boxParsers['mfhd'] = function() {
  this._parseFullBox();
  this.sequence_number = this._readUint(32);
}

// ISO/IEC 14496-12:2012 - 8.2.2 Movie Header Box
ISOBox.prototype._boxParsers['mvhd'] = function() {
  this._parseFullBox();
  
  if (this.version == 1) {
    this.creation_time     = this._readUint(64);
    this.modification_time = this._readUint(64);
    this.timescale         = this._readUint(32);
    this.duration          = this._readUint(64);
  } else {
    this.creation_time     = this._readUint(32);
    this.modification_time = this._readUint(32);
    this.timescale         = this._readUint(32);
    this.duration          = this._readUint(32);      
  }
  
  this.rate      = this._readTemplate(32);
  this.volume    = this._readTemplate(16);
  this.reserved1 = this._readUint(16);
  this.reserved2 = [ this._readUint(32), this._readUint(32) ];
  this.matrix = [];
  for (var i=0; i<9; i++) {
    this.matrix.push(this._readTemplate(32));
  }
  this.pre_defined = [];
  for (var i=0; i<6; i++) {
    this.pre_defined.push(this._readUint(32));
  }
  this.next_track_ID = this._readUint(32);
}

// ISO/IEC 14496-12:2012 - 8.16.3 Segment Index Box
ISOBox.prototype._boxParsers['sidx'] = function() {
  this._parseFullBox();
  this.reference_ID = this._readUint(32);
  this.timescale = this._readUint(32);
  if (this.version == 0) {
    this.earliest_presentation_time = this._readUint(32);
    this.first_offset = this._readUint(32);
  } else {
    this.earliest_presentation_time = this._readUint(64);
    this.first_offset = this._readUint(64);    
  }
  this.reserved = this._readUint(16);
  this.reference_count = this._readUint(16);
  this.references = [];
  for (var i=0; i<this.reference_count; i++) {
    var ref = {};
    var reference = this._readUint(32);
    ref.reference_type = (reference >> 31) & 0x1;
    ref.referenced_size = reference & 0x7FFFFFFF;
    ref.subsegment_duration = this._readUint(32);
    var sap = this._readUint(32);
    ref.starts_with_SAP = (sap >> 31) & 0x1;
    ref.SAP_type = (sap >> 28) & 0x7;
    ref.SAP_delta_time = sap & 0xFFFFFFF;
    this.references.push(ref);
  }
}

// ISO/IEC 14496-12:2012 - 8.3.2 Track Header Box
ISOBox.prototype._boxParsers['tkhd'] = function() {
  this._parseFullBox();
  
  if (this.version == 1) {
    this.creation_time     = this._readUint(64);
    this.modification_time = this._readUint(64);
    this.track_ID          = this._readUint(32);
    this.reserved1         = this._readUint(32);
    this.duration          = this._readUint(64);
  } else {
    this.creation_time     = this._readUint(32);
    this.modification_time = this._readUint(32);
    this.track_ID          = this._readUint(32);
    this.reserved1         = this._readUint(32);
    this.duration          = this._readUint(32);
  }
  
  this.reserved2 = [
    this._readUint(32),
    this._readUint(32)
  ];
  this.layer = this._readUint(16);
  this.alternate_group = this._readUint(16);
  this.volume = this._readTemplate(16);
  this.reserved3 = this._readUint(16);
  this.matrix = [];
  for (var i=0; i<9; i++) {
    this.matrix.push(this._readTemplate(32));
  }
  this.width = this._readUint(32);
  this.height = this._readUint(32);
}

// ISO/IEC 14496-12:2012 - 8.8.12 Track Fragmnent Decode Time
ISOBox.prototype._boxParsers['tfdt'] = function() {
  this._parseFullBox();
  if (this.version == 1) {
    this.baseMediaDecodeTime = this._readUint(64);
  } else {
    this.baseMediaDecodeTime = this._readUint(32);    
  }
}

// ISO/IEC 14496-12:2012 - 8.8.7 Track Fragmnent Header Box
ISOBox.prototype._boxParsers['tfhd'] = function() {
  this._parseFullBox();
  this.track_ID = this._readUint(32);
  if (this.flags & 0x1) this.base_data_offset = this._readUint(64);
  if (this.flags & 0x2) this.sample_description_offset = this._readUint(32);
  if (this.flags & 0x8) this.default_sample_duration = this._readUint(32);
  if (this.flags & 0x10) this.default_sample_size = this._readUint(32);
  if (this.flags & 0x20) this.default_sample_flags = this._readUint(32);
}