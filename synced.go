package main

import (
	"net/http"
	"log"
	"fmt"
	"golang.org/x/net/websocket"
	"encoding/json"
	"sync"
	"io/ioutil"
	"strings"
	"encoding/gob"
	"os"
	"runtime"
	"github.com/satori/go.uuid"
)

var ClientsByEmail map[string]*DALClient
var ClientsByWs map[*websocket.Conn]*DALClient
var ClientsByUn map[string]*DALClient
var GroupsById map[string]Group
var mutex = &sync.Mutex{}
var mutex2 = &sync.Mutex{}
var PendingFR map[string]map[string]string
var Invites map[string]string
var empty struct{}
var fileName = "users.gob"

func init(){
	ClientsByEmail = make(map[string]*DALClient)
	ClientsByWs = make(map[*websocket.Conn]*DALClient)
	Invites = make(map[string]string)
	//impliment usernames
	ClientsByUn = make(map[string]*DALClient)
	GroupsById = make(map[string]Group)
	PendingFR = make(map[string]map[string]string)
	err := LoadData()
	Check(err)
}

func LoadData() error {
	if _, err := os.Stat(fileName); os.IsNotExist(err) {
	  return nil
	}
	file, err := os.Open(fileName)
	var data = new (DataStore)
	if err == nil {
		decoder := gob.NewDecoder(file)
		err = decoder.Decode(data)
	}
	file.Close()
	PendingFR = data.PendingFR
	for i:= 0; i < len(data.Clients); i++{
		ClientsByEmail[data.Clients[i].Email] = &data.Clients[i]
	}
	return err
}

func SaveData() error{
	clients := make([]DALClient, 0, len(ClientsByEmail))
	for  _, value := range ClientsByEmail {
		c := *value
		c.guid = ""
		c.group = ""
		c.ws = nil
		clients = append(clients, c)
	}
	data := DataStore{clients, PendingFR}
	file, err := os.Create(fileName)
	if err == nil {
		encoder := gob.NewEncoder(file)
		encoder.Encode(data)
	}
	file.Close()
	return err
}

func Check(e error) {
	if e != nil {
		_, file, line, _ := runtime.Caller(1)
		fmt.Println(line, "\t", file, "\n", e)
		os.Exit(1)
	}
}

func AddUpdateClient(c DALClient){
	c.Email = strings.ToLower(c.Email)
	mutex.Lock()
	cl := ClientsByEmail[c.Email]
	if cl != nil {
		c.Friends = (*cl).Friends
	}
	ClientsByWs[c.ws] = &c
	ClientsByEmail[c.Email] = &c
	mutex.Unlock()
	err := SaveData()
	Check(err)
}

func AddUpdateGroup(g Group){
	mutex2.Lock()
	GroupsById[g.guid] = g
	mutex2.Unlock()
}

func MakeGroup(c DALClient) string{
	c.Email = strings.ToLower(c.Email)
	kicks := make(map[string]map[string]struct{})
	cs := make(map[string]*DALClient)
	cs[c.Email]= &c
	group := Group{cs ,fmt.Sprintf("%s",uuid.NewV4()), kicks}
	go AddUpdateGroup(group)
	c.group = group.guid
	go AddUpdateClient(c)
	return fmt.Sprintf("%s", group.guid)
}

func GetOauthInfo(token string) DALClient{
	resp, err := http.Get("https://www.googleapis.com/oauth2/v1/userinfo?alt=json&access_token="+token)
	if err != nil {
		fmt.Println(err)
	}
	body, err := ioutil.ReadAll(resp.Body)	
	var client DALClient
	err = json.Unmarshal(body, &client)
	if err != nil {
		fmt.Println(err)
	}
	client.Email = strings.ToLower(client.Email)
	return client
}

func Authorize(ws *websocket.Conn, key string) bool {
	client := ClientsByWs[ws]
	if client != nil {
		return client.guid == key
	}
	return false
}

func ProcessCommand(ws *websocket.Conn, msg string){
	var cmd Message
	err := json.Unmarshal([]byte(msg), &cmd)
	if err != nil {
		fmt.Println(err)
		return
	}
	switch cmd.Command {
		case "Login":			
			client := GetOauthInfo(strings.Replace(cmd.Data, "\"", "", -1))
			if client.Email != ""{
				fmt.Println(client.Email, "Logged in")
				client.ws = ws
				client.guid = fmt.Sprintf("%s",uuid.NewV4())
				AddUpdateClient(client)
				client = *ClientsByEmail[client.Email]
				on, off, pend, reqs := GetClients(client)
				li := LoginInfo{Guid:client.guid, Online:on, Offline:off, Pending:pend, Requests:reqs}
				lis, _ := json.Marshal(li)
				lr := Response{Type:"LoginInfo", Data:string(lis)}
				res, _ := json.Marshal(lr)
				ws.Write(res)
				NotifyFriends(client)
			}
		default :
			if Authorize(ws, cmd.Key) {
				switch cmd.Command{
				case "Event":
					client := *ClientsByWs[ws]
					MessageGroup(client.group, msg, ws, false)
				case "GroupInfo":
					GroupInfo(ws)
				case "AddFriend":
					var client DTOClient
					err := json.Unmarshal([]byte(cmd.Data), &client)
					if err != nil{
						fmt.Println(err)
						return
					}
					AddFriend(client, ws)
				case "RemoveFriend":
					var gi GroupInvite
					err := json.Unmarshal([]byte(cmd.Data), &gi)
					if err == nil{
						RemoveFriend(gi.Email, ws)
					}
				case "Invite":
					client := *ClientsByWs[ws]
					var gi GroupInvite
					err := json.Unmarshal([]byte(cmd.Data), &gi)
					if err != nil {
						fmt.Println(err)
						return
					}
					if client.group == "" {
						groupID := MakeGroup(client)
						gi.GroupID =groupID
						gr := Response{Type:"GroupInfo", Data:groupID}
						res, _ := json.Marshal(gr)
						ws.Write(res)
					} else {
						gi.GroupID = client.group
					}
					if gi.Email != client.Email{
						gi.Client = strings.ToLower(client.Email)
						Invite(ws, gi)
					}
				case "Response":
					var res UserResponse
					err := json.Unmarshal([]byte(cmd.Data), &res)
					if err != nil {
						fmt.Println(err)
						return
					}
					if res.Group {
						if res.Accept {
							guid := Invites[res.Guid]
							delete(Invites, res.Guid)
							AddToGroup(ws, guid)
							go GroupInfo(ws)
						}
						go NotifyGroup(res,ws)
					} else {
						responder := ClientsByWs[ws]
						reqs := PendingFR[responder.Email]
						if reqs[res.Email] == res.Guid{
							delete(reqs, res.Email)
							client:= ClientsByEmail[res.Email]
							PendingFR[responder.Email] = reqs
							if res.Accept {
								if client.Friends == nil {
									client.Friends = make(map[string]bool)
								}
								if responder.Friends == nil {
									responder.Friends = make(map[string]bool)
								}
								client.Friends[responder.Email] = false
								responder.Friends[client.Email] = false
								go AddUpdateClient(*client)
								go AddUpdateClient(*responder)
								NotifyClient(client, responder)
								NotifyClient(responder, client)
							} else {
								if client != nil {
									frs := client.Friends
									if frs != nil {
										delete(frs, responder.Email)
									}
								}
								PendingFR[responder.Email] = reqs
							}
						}
					}
				case "Message":
					client := ClientsByWs[ws]
					if client != nil {
						group := GroupsById[client.group]
						SendChatMessage(group, cmd.Data, client.Email)
					}
				case "Leave":
					RemoveClientFromGroup(ClientsByWs[ws])
				case "Kick":
					var gi GroupInvite
					err := json.Unmarshal([]byte(cmd.Data), &gi)
					if err == nil {
						Kick(ws,gi.Email)
					}
				default:
					fmt.Println(cmd.Command)
					return
			}
		}
	}
}

func MessageGroup(groupId, message string, ws *websocket.Conn, sendToAll bool){
	group := GroupsById[groupId]
	for _, v := range group.clients{
		if (*v).ws != nil {
			if (*v).ws != ws || sendToAll {
				(*v).ws.Write([]byte(message))
			}
		}
	}
}

func GetClients(c DALClient) (online, offline []DTOClient, pending []string, requests []FriendRequest) {
	var on []DTOClient
	var off []DTOClient
	var pend []string
	reqs := PendingFR[c.Email]
	req := make([]FriendRequest, len(reqs))
	i := 0
	for k,v := range reqs {
		req[i] = FriendRequest{k,  v}
		i++
	}
	for k, v := range c.Friends {
		if (v){
			pend = append(pend, k)
			continue
		}
		client := ClientsByEmail[k]
		if client != nil {
			if client.ws != nil {
				dtoC := DTOClient{Email:client.Email, Picture:client.Picture, Online:true}
				on = append(on, dtoC)
			} else {
				dtoC := DTOClient{Email:client.Email, Picture:client.Picture, Online:false}
				off = append(off, dtoC)
			}
		}
	}
	return on, off, pend, req
}

func NotifyClient(client, who *DALClient){
	if client.ws != nil {
		usr := DTOClient{who.Email, who.Picture, who.ws != nil, false}
		usrs, _ := json.Marshal(usr)
		nc := Response{Type:"FriendEvent", Data:string(usrs)}
		res, _ := json.Marshal(nc)
		client.ws.Write(res)
	}
}

func NotifyFriends(client DALClient){
	for k,v := range client.Friends{
		who := ClientsByEmail[k]
		if who != nil {
			if (!v){
				NotifyClient(who,&client)
			}
		}
	}
}

func AddFriend(user DTOClient, ws *websocket.Conn){
	c := ClientsByWs[ws]
	if _, ok := c.Friends[user.Email]; ok {
		return
	}
	if len(c.Friends) < 50 {
		if c.Email != strings.ToLower(user.Email) {
			fr := PendingFR[user.Email]
			if fr == nil {
				fr = make(map[string]string)
			}
			fr[c.Email] = fmt.Sprintf("%s",uuid.NewV4())
			PendingFR[user.Email]= fr
			if c.Friends == nil {
				c.Friends = make(map[string]bool)
			}
			c.Friends[user.Email]= true
			AddUpdateClient(*c)
			cr := ClientsByEmail[user.Email]
			if cr != nil {
				if cr.ws != nil {
					req := FriendRequest{c.Email,fr[c.Email]}
					res, err := json.Marshal(req)
					if err != nil{
						fmt.Println(err)
						return
					}
					resp := Response{Type:"FriendRequest", Data:string(res)}
					res, err = json.Marshal(resp)
					if err != nil{
						fmt.Println(err)
						return
					}
					cr.ws.Write(res)
				}
			}
		}
	} else {
		Emsg := ErrorMessasge{"You cannot have more than 50 friends"}
		msg, _ := json.Marshal(Emsg)
		resp := Response{Type:"Error", Data:string(msg)}
		res, _ := json.Marshal(resp)
		ws.Write(res);
	}
}

func RemoveFriend(user string, ws *websocket.Conn){
	c := ClientsByWs[ws]
	if c != nil {
		delete(c.Friends, user)
		client := ClientsByEmail[user]
		if client != nil {
			delete(client.Friends, c.Email)
		}
		AddUpdateClient(*c)
		AddUpdateClient(*client)
		delete(PendingFR[user], c.Email)
		
		usr := DTOClient{c.Email, "", false, true}
		usrs, _ := json.Marshal(usr)
		nc := Response{Type:"FriendEvent", Data:string(usrs)}
		res, _ := json.Marshal(nc)
		client.ws.Write(res)
	}
	usr := DTOClient{user, "", false, true}
	usrs, _ := json.Marshal(usr)
	nc := Response{Type:"FriendEvent", Data:string(usrs)}
	res, _ := json.Marshal(nc)
	c.ws.Write(res)
}

func Kick(ws *websocket.Conn, user string){
	client := ClientsByWs[ws]
	if client != nil {
		if client.group != "" {
			group := GroupsById[client.group]
			kicks := group.kicks[user]
			if len(kicks) == 0 {
				kicks = make(map[string]struct{})
			}
			kicks[client.Email] = empty
			if float64(len(kicks))/float64(len(group.clients)-1) > 0.6{
				c:= ClientsByEmail[user]
				if c!= nil {
					RemoveClientFromGroup(c)
					msg := fmt.Sprintf("%s has been kicked", user)
					SendChatMessage(group, msg, "System")
					group.kicks[user] = make(map[string]struct{})
					AddUpdateGroup(group)
					if c.ws != nil {
						kick := Response{Type:"Event", Data:""}
						res, _ := json.Marshal(kick)
						c.ws.Write(res)
					}
				}
			} else {
				msg := fmt.Sprintf("%d/%d have voted to kick %s",len(kicks),len(group.clients)-1, user)
				SendChatMessage(group, msg, "System")
				group.kicks[user] = kicks
				AddUpdateGroup(group)
			}
		}
	}
}

func GroupInfo(ws *websocket.Conn){
	client := *ClientsByWs[ws]
	group := GroupsById[client.group]
	var clients []DTOClient
	for k, v := range group.clients{
		if k != client.Email {
			clients = append(clients, DTOClient{k, (*v).Picture, false, false})
		}
	}
	var data []byte
	if len(clients)> 0 {
		data, _ = json.Marshal(clients)
	} else {
		data = nil
	}
	m := Response {Type:"GMembers",Data:string(data)}
	res, _ := json.Marshal(m)
	ws.Write(res)
}

func SendChatMessage(group Group, message, from string){
	cm, _ := json.Marshal(ChatMessage{From:from, Text:message})
	m := Response {"Message",string(cm)}
	res, _ := json.Marshal(m)
	MessageGroup(group.guid, string(res), nil, true)
}

func NotifyGroup(res UserResponse, ws *websocket.Conn){
	client := *ClientsByWs[ws]
	ge := GroupEvent{User:client.Email, Picture:client.Picture , Accept:res.Accept, Left:false}
	ges, _ := json.Marshal(ge)
	message := Response{Type:"GroupEvent", Data:string(ges)}
	response, _ := json.Marshal(message)
	MessageGroup(res.Guid, string(response), ws, false)
}

func NotifyLeft(client DALClient){
	if client.group !="" {
		ge := GroupEvent{User:client.Email, Accept:false, Left:true}
		ges, _ := json.Marshal(ge)
		message := Response{Type:"GroupEvent", Data:string(ges)}
		res, _ := json.Marshal(message)
		MessageGroup(client.group, string(res), client.ws, false )
	}
}

func Invite(ws *websocket.Conn, gi GroupInvite){
	client:=ClientsByEmail[gi.Email]
	if client!= nil {
		invite := ClientsByEmail[gi.Email]
		if !IsInGroup(invite.Email, gi.GroupID){
			if client.ws != nil {
				id := fmt.Sprintf("%s",uuid.NewV4())
				Invites[id] = gi.GroupID
				gi.GroupID = id
				data, _ := json.Marshal(gi)
				message := Response{Type:"Invite", Data:string(data)}
				res, _ := json.Marshal(message)
				client.ws.Write(res)
			}
		}
	}
}

func IsInGroup(client string, groupId string) bool{
	group:= GroupsById[groupId]
	return group.clients[client] != nil
}

func AddToGroup(ws *websocket.Conn, groupId string){
	client := *ClientsByWs[ws]
	group := GroupsById[groupId]
	if client.group != ""{
		RemoveClientFromGroup(&client)
	}
	client.group = groupId
	AddUpdateClient(client)
	if !IsInGroup(client.Email, groupId){
		if group.clients != nil {
			group.clients[client.Email] = &client
			AddUpdateGroup( group)
		}
	}
}

func RemoveClientFromGroup(client *DALClient){
	NotifyLeft(*client);
	group:=GroupsById[(*client).group]
	delete(group.clients, client.Email)
	AddUpdateGroup(group)
	client.group = ""
	AddUpdateClient(*client)
}

func RemoveClient(ws *websocket.Conn){
	client := ClientsByWs[ws]
	if client != nil {
		RemoveClientFromGroup(client)
		client.group = ""
		client.ws = nil
	}
	AddUpdateClient(*client)
}

func Process(ws *websocket.Conn) {
	var err error
	for {
		var msg string
		if err = websocket.Message.Receive(ws, &msg); err != nil {
			client := ClientsByWs[ws]
			if client != nil {
				NotifyLeft(*client)
				RemoveClient(ws)
				NotifyFriends(*client)
			}
			break;
		}
		go ProcessCommand(ws, msg)
	}
}

func main() {
	http.Handle("/", websocket.Handler(Process))
	fmt.Println("Server Started")
	log.Fatal(http.ListenAndServe(":6969", nil))
}

type DataStore struct{
	Clients []DALClient
	PendingFR map[string]map[string]string
}
type FriendRequest struct{
	From string
	Guid string
}
type ErrorMessasge struct {
	Error string
}
type LoginInfo struct {
	Guid string
	Online []DTOClient
	Offline []DTOClient
	Pending []string
	Requests []FriendRequest
}
type Response struct {
	Type string `json:"type"`
	Data string `json:"data"`
}
type ChatMessage struct {
	Text string `json:"text"`
	From string `json:"from"`
}
type GroupInvite struct {
	Client string `json:"Client"`
	Email string `json:"email"`
	GroupID string `json:"GroupID"`
}
type Message struct {
	Command string `json:"command"`
	Data string `json:"data"`
	Key string `json:"key"`
}
type Group struct {
	clients map[string]*DALClient
	guid string
	kicks map[string]map[string]struct{}
}
type GroupEvent struct {
	Accept bool
	Left bool
	Picture string
	User string `json:"email"`
}
type DTOClient struct {
	Email string `json:"email"`
	Picture string `json:"picture"`
	Online bool
	Removed bool
}
type DALClient struct {
	Picture string `json:"picture"`
	ws *websocket.Conn
	Email string `json:"email"`
	guid string
	group string
	userName string
	number string
	Friends map[string]bool
}
type UserResponse struct {
	Email string `json:"Email"`
	Guid string `json:"Guid"`
	Accept bool `json:"Accept"`
	Group bool `json:"Group"`
}
