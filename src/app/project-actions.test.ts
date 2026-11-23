import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {ActingUser,ProjectFacts} from '@/server/permissions';
const f=vi.hoisted(()=>({session:vi.fn(),facts:vi.fn(),copy:vi.fn(),templates:vi.fn()}));
vi.mock('@/server/auth/current-user',()=>({requireUser:f.session,requireUserWithoutPasswordChange:f.session}));
vi.mock('@/server/db',async original=>({...await original<object>(),getDb:()=>({})}));
vi.mock('@/server/services/projects',async original=>({...await original<object>(),loadFacts:f.facts}));
vi.mock('@/server/services/project-checklist',async original=>({...await original<object>(),buildChecklistFromProject:f.copy,buildChecklistFromTemplates:f.templates}));
import {resolveWizardChecklist} from './project-actions';
const manager:ActingUser={id:'manager',role:'manager',divisionIds:['division'],isActive:true};
const facts=(members:string[]):ProjectFacts=>({id:'source',status:'active',ownerUserId:null,ownerDivisionId:'division',divisionIds:[],memberIds:members,leadIds:[],adminProjectIds:[]});
function request(){const data=new FormData();data.set('checklistSource','project');data.set('sourceProjectId','source');return data;}
beforeEach(()=>{vi.resetAllMocks();f.session.mockResolvedValue({user:manager});f.copy.mockResolvedValue([{sourceItemId:'item',label:'Private source',phase:'opening'}]);});
describe('checklist copy respects project visibility on the server',()=>{
 it('denies even a same-division manager outside the source project before reading its checklist',async()=>{
  f.facts.mockResolvedValue(facts([]));await expect(resolveWizardChecklist(request())).rejects.toThrow(/Project sumber/);expect(f.copy).not.toHaveBeenCalled();
 });
 it('permits a manager who is an active source member',async()=>{
  f.facts.mockResolvedValue(facts(['manager']));expect((await resolveWizardChecklist(request())).rows).toHaveLength(1);expect(f.copy).toHaveBeenCalledWith({},'source');
 });
 it('permits Admin to copy across projects',async()=>{
  f.session.mockResolvedValue({user:{...manager,role:'admin'}});f.facts.mockResolvedValue(facts([]));expect((await resolveWizardChecklist(request())).rows).toHaveLength(1);
 });
 it('requires authentication and a project-creation role',async()=>{
  f.session.mockRejectedValueOnce(new Error('login required'));await expect(resolveWizardChecklist(request())).rejects.toThrow(/login/);expect(f.copy).not.toHaveBeenCalled();
  f.session.mockResolvedValue({user:{...manager,role:'user'}});await expect(resolveWizardChecklist(request())).rejects.toThrow(/berhak/);expect(f.copy).not.toHaveBeenCalled();
 });
});
