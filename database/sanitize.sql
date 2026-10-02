-- Keep a known local login without colliding on uk_user_login (login, entity).
UPDATE llx_user SET pass='admin', statut=1 WHERE login='admin';
UPDATE llx_user SET pass='admin', login='admin', statut=1
 WHERE login='scopen'
   AND NOT EXISTS (
     SELECT 1 FROM (SELECT rowid FROM llx_user WHERE login='admin') AS existing_admin
   );
UPDATE llx_user SET pass='admin', statut=1 WHERE login='scopen';
UPDATE llx_user SET pass=login WHERE login NOT IN ('admin','scopen');
UPDATE llx_user SET pass=login WHERE pass<>'admin' OR pass IS NULL;
DELETE FROM llx_const WHERE name='MAIN_MODULE_SYSLOG';
DELETE FROM llx_const WHERE name='SYSLOG_LEVEL';
DELETE FROM llx_const WHERE name='SYSLOG_FILE';
DELETE FROM llx_const WHERE name='MAIN_MAIL_SENDMODE';
DELETE FROM  llx_const WHERE name='CHECKLASTVERSION_EXTERNALMODULE';
DELETE FROM  llx_const WHERE name='MAIN_REMOVE_INSTALL_WARNING';
DELETE FROM  llx_const WHERE name='MAIN_ALLOW_WYSIWYG_LOCAL_MEDIAS_ON_PRIVATE_NETWORK';
DELETE FROM  llx_const WHERE name='MAIN_NO_UPGRADE_REDIRECT_ON_LEVEL_3_CHANGE';
INSERT INTO llx_const(name,entity,value,type,visible) VALUES ('MAIN_MODULE_SYSLOG',0,'1','string',0);
INSERT INTO llx_const(name,entity,value,type,visible) VALUES ('SYSLOG_FILE',0,'DOL_DATA_ROOT/dolibarr.log','string',0);
INSERT INTO llx_const(name,entity,value,type,visible) VALUES ('SYSLOG_LEVEL',0,'7','string',0);
INSERT INTO llx_const(name,entity,value,type,visible) VALUES ('MAIN_MAIL_SENDMODE',0,'mail','string',0);
INSERT INTO llx_const(name,entity,value,type,visible) VALUES ('CHECKLASTVERSION_EXTERNALMODULE',0,'0','string',1);
INSERT INTO llx_const(name,entity,value,type,visible) VALUES ('MAIN_ALLOW_WYSIWYG_LOCAL_MEDIAS_ON_PRIVATE_NETWORK',1,'0','string',1);
INSERT INTO llx_const(name,entity,value,type,visible) VALUES ('MAIN_NO_UPGRADE_REDIRECT_ON_LEVEL_3_CHANGE',0,'1','string',0);


DELETE FROM llx_const WHERE name='MAIN_SECURITY_ENABLECAPTCHA';

DELETE FROM llx_user_param WHERE param='MAIN_LANG_DEFAULT';

UPDATE llx_const SET value='0' WHERE name='THEME_DARKMODEENABLED';
